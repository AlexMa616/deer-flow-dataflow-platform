#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/logs"
RUN_DIR="$ROOT_DIR/.run"
NGINX_CONF="$ROOT_DIR/docker/nginx/nginx.local.conf"
UV_CACHE_DIR="${UV_CACHE_DIR:-$ROOT_DIR/.uv-cache}"

PORT_PROXY="${PORT_PROXY:-2026}"
PORT_LANGGRAPH="${PORT_LANGGRAPH:-2024}"
PORT_GATEWAY="${PORT_GATEWAY:-8001}"
PORT_FRONTEND="${PORT_FRONTEND:-3000}"
CLEAN_FRONTEND_CACHE="${DEERFLOW_CLEAN_FRONTEND_CACHE:-0}"

ADMIN_USERNAME="${DEERFLOW_ADMIN_USERNAME:-admin}"
ADMIN_PASSWORD="${DEERFLOW_ADMIN_PASSWORD:-admin123}"
ADMIN_EMAIL="${DEERFLOW_ADMIN_EMAIL:-admin@local.dev}"
ADMIN_RESET_PASSWORD="${DEERFLOW_ADMIN_RESET_PASSWORD:-0}"
SKIP_ADMIN_BOOTSTRAP="${DEERFLOW_SKIP_ADMIN_BOOTSTRAP:-0}"

print() {
  printf "[deer-flow] %s\n" "$*"
}

ensure_dirs() {
  mkdir -p "$LOG_DIR" "$RUN_DIR" "$UV_CACHE_DIR"
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    print "缺少依赖: $cmd"
    exit 1
  fi
}

ensure_base_files() {
  [[ -f "$ROOT_DIR/config.yaml" ]] || cp "$ROOT_DIR/config.example.yaml" "$ROOT_DIR/config.yaml"
  [[ -f "$ROOT_DIR/.env" ]] || cp "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
  [[ -f "$FRONTEND_DIR/.env" ]] || cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env"
  [[ -f "$NGINX_CONF" ]] || {
    print "未找到 Nginx 配置: $NGINX_CONF"
    exit 1
  }
}

kill_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    local pids
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN || true)"
    if [[ -n "$pids" ]]; then
      kill $pids 2>/dev/null || true
    fi
  elif command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

stop_by_pidfile() {
  local name="$1"
  local pidfile="$RUN_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
}

cleanup_orphans() {
  pkill -f "langgraph dev" 2>/dev/null || true
  pkill -f "uvicorn src.gateway.app:app" 2>/dev/null || true
  pkill -f "next dev" 2>/dev/null || true
  nginx -c "$NGINX_CONF" -p "$ROOT_DIR" -s quit 2>/dev/null || true
  kill_port "$PORT_PROXY"
  kill_port "$PORT_GATEWAY"
  kill_port "$PORT_LANGGRAPH"
  kill_port "$PORT_FRONTEND"
  "$ROOT_DIR/scripts/cleanup-containers.sh" deer-flow-sandbox 2>/dev/null || true
}

stop_all() {
  print "停止现有服务..."
  stop_by_pidfile "nginx"
  stop_by_pidfile "frontend"
  stop_by_pidfile "gateway"
  stop_by_pidfile "langgraph"
  cleanup_orphans
  print "服务已停止"
}

status_service() {
  local name="$1"
  local pidfile="$RUN_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      printf "%-10s running (pid=%s)\n" "$name" "$pid"
      return
    fi
  fi
  printf "%-10s stopped\n" "$name"
}

wait_for_port() {
  local port="$1"
  local timeout="${2:-30}"
  local waited=0
  while (( waited < timeout )); do
    if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      return 0
    fi
    if command -v nc >/dev/null 2>&1 && nc -z 127.0.0.1 "$port" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

wait_for_http() {
  local url="$1"
  local timeout="${2:-30}"
  local waited=0
  while (( waited < timeout )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

warm_http() {
  local url="$1"
  curl -fsS "$url" >/dev/null 2>&1 || true
}

start_process() {
  local name="$1"
  local cwd="$2"
  shift 2
  local pidfile="$RUN_DIR/$name.pid"
  local logfile="$LOG_DIR/$name.log"

  print "启动 ${name}..."
  (
    cd "$cwd"
    nohup bash -c 'trap "" HUP INT; exec "$@"' _ "$@" >"$logfile" 2>&1 </dev/null &
    echo $! >"$pidfile"
  )
}

bootstrap_admin() {
  if [[ "$SKIP_ADMIN_BOOTSTRAP" == "1" ]]; then
    print "跳过管理员初始化 (DEERFLOW_SKIP_ADMIN_BOOTSTRAP=1)"
    return
  fi

  print "初始化管理员账号..."
  local bootstrap_log="$LOG_DIR/bootstrap-admin.log"
  : >"$bootstrap_log"
  (
    cd "$BACKEND_DIR"
    # 修复了 PYTHONPATH 问题，确保能找到 src 模块
    PYTHONPATH=. \
    DEERFLOW_ADMIN_USERNAME="$ADMIN_USERNAME" \
    DEERFLOW_ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    DEERFLOW_ADMIN_EMAIL="$ADMIN_EMAIL" \
    DEERFLOW_ADMIN_RESET_PASSWORD="$ADMIN_RESET_PASSWORD" \
    uv run python scripts/bootstrap_admin.py
  ) >>"$bootstrap_log" 2>&1 || {
    print "管理员初始化失败，继续启动服务（详情见 $bootstrap_log）"
  }

  if [[ "$ADMIN_USERNAME" == "admin" && "$ADMIN_PASSWORD" == "admin123" ]]; then
    print "当前使用默认管理员凭据 admin/admin123，建议尽快修改"
  fi
}

start_all() {
  ensure_dirs
  export UV_CACHE_DIR
  require_cmd uv
  require_cmd pnpm
  require_cmd nginx
  require_cmd curl
  ensure_base_files

  stop_all
  bootstrap_admin

  start_process "langgraph" "$BACKEND_DIR" env NO_COLOR=1 uv run langgraph dev --no-browser --allow-blocking --no-reload
  wait_for_port "$PORT_LANGGRAPH" 40 || {
    print "LangGraph 启动失败，请查看 $LOG_DIR/langgraph.log"
    exit 1
  }

  start_process "gateway" "$BACKEND_DIR" uv run uvicorn src.gateway.app:app --host 0.0.0.0 --port "$PORT_GATEWAY"
  wait_for_http "http://127.0.0.1:${PORT_GATEWAY}/health" 40 || {
    print "Gateway 启动失败，请查看 $LOG_DIR/gateway.log"
    exit 1
  }

  if [[ "$CLEAN_FRONTEND_CACHE" == "1" ]]; then
    print "按需清理前端缓存 (.next)..."
    rm -rf "$FRONTEND_DIR/.next"
  fi

  start_process "frontend" "$FRONTEND_DIR" pnpm exec next dev --webpack --port "$PORT_FRONTEND"
  wait_for_http "http://127.0.0.1:${PORT_FRONTEND}" 60 || {
    print "Frontend 启动失败，请查看 $LOG_DIR/frontend.log"
    exit 1
  }
  print "预热前端路由..."
  warm_http "http://127.0.0.1:${PORT_FRONTEND}/login"
  warm_http "http://127.0.0.1:${PORT_FRONTEND}/workspace/chats/new"
  warm_http "http://127.0.0.1:${PORT_FRONTEND}/workspace/vibe/new"

  start_process "nginx" "$ROOT_DIR" nginx -g "daemon off;" -c "$NGINX_CONF" -p "$ROOT_DIR"
  wait_for_http "http://127.0.0.1:${PORT_PROXY}/api/health" 40 || {
    print "Nginx 启动失败，请查看 $LOG_DIR/nginx.log"
    exit 1
  }

  print "启动完成!"
  print "访问地址: http://127.0.0.1:${PORT_PROXY}"
}

show_status() {
  status_service "langgraph"
  status_service "gateway"
  status_service "frontend"
  status_service "nginx"
}

show_logs() {
  ensure_dirs
  tail -f "$LOG_DIR"/langgraph.log "$LOG_DIR"/gateway.log "$LOG_DIR"/frontend.log "$LOG_DIR"/nginx.log
}

main() {
  local action="${1:-start}"
  case "$action" in
    start) start_all ;;
    stop) stop_all ;;
    restart) stop_all; start_all ;;
    status) show_status ;;
    logs) show_logs ;;
    *)
      cat <<EOF
用法: ./start-all.sh [start|stop|restart|status|logs]
EOF
      exit 1
      ;;
  esac
}

main "$@"

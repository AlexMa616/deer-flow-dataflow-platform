"""数据血缘及路径操作追踪与报警中间站(MiddleWare Pipeline Metrics)."""

import logging
from pathlib import Path
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.runtime import Runtime

logger = logging.getLogger(__name__)


class DataLineageMiddlewareState(AgentState):
    """Compatible tracking local log for tool behavior lineage tracing configs."""

    pass


class DataLineageMiddleware(AgentMiddleware[DataLineageMiddlewareState]):
    """记录 tool 后处理轨迹，并把明显异常写入日志供排查."""

    state_schema = DataLineageMiddlewareState

    def _is_anomaly(self, content_str: str) -> bool:
        # 异常警预判断基逻辑：如报错词/拒绝访问/脚本执行致命等均视为 anomaly (偏航)
        s = content_str.lower()
        if (
            "error" in s
            or "failed" in s
            or "exception" in s
            or "traceback" in s
            or "command not found" in s
        ):
            return True
        return False

    @override
    def after_agent(self, state: DataLineageMiddlewareState, runtime: Runtime) -> dict | None:
        """从回发消息抽丝，记录工作流水栈轨迹"""
        thid = runtime.context.get("thread_id")
        if not thid:
            return None

        msgs = state.get("messages", [])
        if not msgs:
            return None

        last_item = msgs[-1]

        # 我们监听 "tool" 类型：意指真正做出了执行举派和拿到加工事实的反馈行为点。
        if getattr(last_item, "type", None) == "tool":
            act_origin = getattr(last_item, "name", "unknown_operation")
            act_resp = str(getattr(last_item, "content", "NULL RESP"))

            alarm = self._is_anomaly(act_resp)

            lineage_str = (
                f"-[Action:{act_origin}] => OutputSample(first 50chars): "
                f"{act_resp[:50]}, AnomalyDetect:{alarm}\n"
            )

            metrics_log = Path(f".deer-flow/threads/{thid}/lineage_metrics.log")
            metrics_log.parent.mkdir(parents=True, exist_ok=True)

            with open(metrics_log, "a", encoding="utf-8") as fw:
                fw.write(lineage_str)

            if alarm:
                logger.warning(
                    "[Data-Lineage Tracker Notice] Exception Captured Post-tool "
                    "execution: -> Tracker Marked Issue From Actor:%s !",
                    act_origin,
                )

        return None

"""Thread-scoped terminal router with streaming shell output."""

from __future__ import annotations

import fcntl
import json
import logging
import os
import pty
import queue
import select
import signal
import struct
import subprocess
import termios
import threading
import time
import uuid
from pathlib import Path
from queue import Empty
from typing import Literal

import anyio
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/threads/{thread_id}/terminal", tags=["terminal"])

PROJECT_ROOT = Path(__file__).resolve().parents[4]
MAX_HISTORY_CHARS = 200_000
EVENT_QUEUE_SIZE = 256
SHELL_PROMPT = "deer-flow:%~ %# "


class TerminalState(BaseModel):
    """Public terminal session state."""

    thread_id: str
    session_id: str
    status: Literal["starting", "running", "stopping", "stopped"]
    cwd: str
    started_at: float | None = None
    updated_at: float | None = None
    exit_code: int | None = None


class TerminalSnapshot(BaseModel):
    """Terminal snapshot payload."""

    state: TerminalState
    history: str = ""


class TerminalStartRequest(BaseModel):
    """Optional terminal start options."""

    cwd: str | None = None


class TerminalInputRequest(BaseModel):
    """Terminal input payload."""

    data: str = Field(min_length=1)
    add_newline: bool = True


class TerminalControlResponse(BaseModel):
    """Terminal action response."""

    success: bool
    state: TerminalState


class TerminalResizeRequest(BaseModel):
    """Resize payload for the interactive terminal."""

    cols: int = Field(ge=2, le=400)
    rows: int = Field(ge=1, le=200)


def resolve_workspace_path(path: str | None = None) -> Path:
    """Resolve a user-provided path within the project workspace."""
    if not path:
        return PROJECT_ROOT

    candidate = Path(path)
    if not candidate.is_absolute():
        candidate = (PROJECT_ROOT / candidate).resolve()
    else:
        candidate = candidate.resolve()

    try:
        candidate.relative_to(PROJECT_ROOT)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Terminal path must stay inside the workspace") from exc

    if not candidate.exists() or not candidate.is_dir():
        raise HTTPException(status_code=400, detail="Terminal path does not exist")

    return candidate


def _format_sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _safe_queue_put(target: queue.Queue[dict], item: dict) -> None:
    try:
        target.put_nowait(item)
        return
    except queue.Full:
        try:
            target.get_nowait()
        except queue.Empty:
            pass
    try:
        target.put_nowait(item)
    except queue.Full:
        return


class TerminalSession:
    """Interactive terminal session backed by a persistent zsh shell."""

    def __init__(self, thread_id: str, cwd: Path):
        self.thread_id = thread_id
        self.cwd = cwd
        self.session_id = str(uuid.uuid4())
        self.status: Literal["starting", "running", "stopping", "stopped"] = "stopped"
        self.started_at: float | None = None
        self.updated_at: float | None = None
        self.exit_code: int | None = None
        self.history = ""
        self.process: subprocess.Popen[bytes] | None = None
        self.master_fd: int | None = None
        self._reader_thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._subscribers: set[queue.Queue[dict]] = set()

    def snapshot_state(self) -> TerminalState:
        with self._lock:
            return TerminalState(
                thread_id=self.thread_id,
                session_id=self.session_id,
                status=self.status,
                cwd=str(self.cwd),
                started_at=self.started_at,
                updated_at=self.updated_at,
                exit_code=self.exit_code,
            )

    def snapshot(self) -> TerminalSnapshot:
        with self._lock:
            return TerminalSnapshot(
                state=TerminalState(
                    thread_id=self.thread_id,
                    session_id=self.session_id,
                    status=self.status,
                    cwd=str(self.cwd),
                    started_at=self.started_at,
                    updated_at=self.updated_at,
                    exit_code=self.exit_code,
                ),
                history=self.history,
            )

    def subscribe(self) -> queue.Queue[dict]:
        subscriber: queue.Queue[dict] = queue.Queue(maxsize=EVENT_QUEUE_SIZE)
        with self._lock:
            self._subscribers.add(subscriber)
        return subscriber

    def unsubscribe(self, subscriber: queue.Queue[dict]) -> None:
        with self._lock:
            self._subscribers.discard(subscriber)

    def _publish(self, payload: dict) -> None:
        with self._lock:
            subscribers = list(self._subscribers)
        for subscriber in subscribers:
            _safe_queue_put(subscriber, payload)

    def _append_history(self, text: str) -> None:
        if not text:
            return
        with self._lock:
            self.history = (self.history + text)[-MAX_HISTORY_CHARS:]
            self.updated_at = time.time()

    def is_running(self) -> bool:
        with self._lock:
            return self.process is not None and self.process.poll() is None and self.status in {"starting", "running"}

    def set_cwd(self, cwd: Path) -> None:
        with self._lock:
            self.cwd = cwd

    def start(self) -> None:
        if self.is_running():
            return

        with self._lock:
            self.status = "starting"
            self.exit_code = None
            self.session_id = str(uuid.uuid4())
            self.started_at = time.time()
            self.updated_at = self.started_at

        master_fd, slave_fd = pty.openpty()
        env = os.environ.copy()
        env.update(
            {
                "TERM": "xterm-256color",
                "COLORTERM": "truecolor",
                "PS1": SHELL_PROMPT,
                "PROMPT": SHELL_PROMPT,
            }
        )

        process = subprocess.Popen(
            ["/bin/zsh", "-i", "-f"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=self.cwd,
            env=env,
            start_new_session=True,
            close_fds=True,
        )
        os.close(slave_fd)

        with self._lock:
            self.process = process
            self.master_fd = master_fd
            self.status = "running"
            self.updated_at = time.time()

        self._reader_thread = threading.Thread(
            target=self._read_output,
            daemon=True,
            name=f"terminal-{self.thread_id[:8]}",
        )
        self._reader_thread.start()
        self._publish({"type": "status", "state": self.snapshot_state().model_dump(mode="json")})

    def _read_output(self) -> None:
        while True:
            with self._lock:
                master_fd = self.master_fd
                process = self.process

            if master_fd is None or process is None:
                break

            if process.poll() is not None:
                ready, _, _ = select.select([master_fd], [], [], 0)
                if not ready:
                    break
            else:
                ready, _, _ = select.select([master_fd], [], [], 0.25)
                if not ready:
                    continue

            try:
                chunk = os.read(master_fd, 4096)
            except OSError:
                break

            if not chunk:
                if process.poll() is not None:
                    break
                continue

            text = chunk.decode("utf-8", errors="replace")
            self._append_history(text)
            self._publish(
                {
                    "type": "output",
                    "data": text,
                    "timestamp": time.time(),
                }
            )

        exit_code = None
        process = None
        master_fd = None
        with self._lock:
            process = self.process
            master_fd = self.master_fd

        if process is not None:
            try:
                exit_code = process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                exit_code = process.poll()

        if master_fd is not None:
            try:
                os.close(master_fd)
            except OSError:
                pass

        with self._lock:
            self.master_fd = None
            self.process = None
            self.status = "stopped"
            self.exit_code = exit_code
            self.updated_at = time.time()

        self._publish({"type": "status", "state": self.snapshot_state().model_dump(mode="json")})

    def send_input(self, data: str, add_newline: bool = True) -> TerminalState:
        if not data:
            raise HTTPException(status_code=400, detail="Terminal input cannot be empty")

        with self._lock:
            master_fd = self.master_fd
            process = self.process
            if master_fd is None or process is None or process.poll() is not None:
                raise HTTPException(status_code=409, detail="Terminal session is not running")

        payload = data + ("\n" if add_newline else "")
        try:
            os.write(master_fd, payload.encode("utf-8"))
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Failed to send terminal input") from exc

        with self._lock:
            self.updated_at = time.time()
        return self.snapshot_state()

    def interrupt(self) -> TerminalState:
        with self._lock:
            master_fd = self.master_fd
            process = self.process
            if master_fd is None or process is None or process.poll() is not None:
                raise HTTPException(status_code=409, detail="Terminal session is not running")
        try:
            os.write(master_fd, b"\x03")
        except OSError:
            try:
                os.killpg(process.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
        with self._lock:
            self.updated_at = time.time()
        return self.snapshot_state()

    def resize(self, cols: int, rows: int) -> TerminalState:
        with self._lock:
            master_fd = self.master_fd
            process = self.process
            if master_fd is None or process is None or process.poll() is not None:
                raise HTTPException(status_code=409, detail="Terminal session is not running")

        try:
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
        except OSError as exc:
            raise HTTPException(status_code=500, detail="Failed to resize terminal") from exc

        with self._lock:
            self.updated_at = time.time()
        return self.snapshot_state()

    def stop(self) -> TerminalState:
        with self._lock:
            process = self.process
            if process is None or process.poll() is not None:
                self.status = "stopped"
                self.updated_at = time.time()
                return self.snapshot_state()
            self.status = "stopping"
            self.updated_at = time.time()

        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        except PermissionError:
            process.terminate()

        self._publish({"type": "status", "state": self.snapshot_state().model_dump(mode="json")})
        return self.snapshot_state()


class TerminalManager:
    """In-memory terminal session registry."""

    def __init__(self):
        self._sessions: dict[str, TerminalSession] = {}
        self._lock = threading.Lock()

    def get(self, thread_id: str) -> TerminalSession | None:
        with self._lock:
            return self._sessions.get(thread_id)

    def ensure(self, thread_id: str, cwd: Path | None = None) -> TerminalSession:
        with self._lock:
            session = self._sessions.get(thread_id)
            if session is None:
                session = TerminalSession(thread_id=thread_id, cwd=cwd or PROJECT_ROOT)
                self._sessions[thread_id] = session
            elif cwd is not None and not session.is_running():
                session.set_cwd(cwd)

        session.start()
        return session


terminal_manager = TerminalManager()


@router.post("/start", response_model=TerminalSnapshot)
async def start_terminal(thread_id: str, request: TerminalStartRequest | None = None) -> TerminalSnapshot:
    """Start or resume a terminal shell for the current thread."""
    cwd = resolve_workspace_path(request.cwd if request else None)
    session = terminal_manager.ensure(thread_id, cwd)
    return session.snapshot()


@router.get("/state", response_model=TerminalSnapshot)
async def get_terminal_state(thread_id: str) -> TerminalSnapshot:
    """Return the current terminal state for a thread."""
    session = terminal_manager.get(thread_id)
    if session is None:
        return TerminalSnapshot(
            state=TerminalState(
                thread_id=thread_id,
                session_id="",
                status="stopped",
                cwd=str(PROJECT_ROOT),
                started_at=None,
                updated_at=None,
                exit_code=None,
            ),
            history="",
        )
    return session.snapshot()


@router.get("/stream")
async def stream_terminal(request: Request, thread_id: str) -> StreamingResponse:
    """Stream terminal output for a thread via SSE."""
    session = terminal_manager.get(thread_id)
    if session is None:
        session = terminal_manager.ensure(thread_id, PROJECT_ROOT)
    subscriber = session.subscribe()

    async def event_generator():
        try:
            snapshot = session.snapshot()
            yield _format_sse(
                {
                    "type": "snapshot",
                    "state": snapshot.state.model_dump(mode="json"),
                    "history": snapshot.history,
                }
            )
            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await anyio.to_thread.run_sync(subscriber.get, True, 10)
                    yield _format_sse(item)
                except Empty:
                    yield ": ping\n\n"
        finally:
            session.unsubscribe(subscriber)

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=headers)


@router.post("/input", response_model=TerminalControlResponse)
async def send_terminal_input(thread_id: str, request: TerminalInputRequest) -> TerminalControlResponse:
    """Write input into the thread shell, auto-starting it when needed."""
    session = terminal_manager.ensure(thread_id, PROJECT_ROOT)
    state = session.send_input(request.data, add_newline=request.add_newline)
    return TerminalControlResponse(success=True, state=state)


@router.post("/interrupt", response_model=TerminalControlResponse)
async def interrupt_terminal(thread_id: str) -> TerminalControlResponse:
    """Send Ctrl+C to the current shell process group."""
    session = terminal_manager.get(thread_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Terminal session not found")
    state = session.interrupt()
    return TerminalControlResponse(success=True, state=state)


@router.post("/resize", response_model=TerminalControlResponse)
async def resize_terminal(thread_id: str, request: TerminalResizeRequest) -> TerminalControlResponse:
    """Resize the thread shell to match the front-end terminal viewport."""
    session = terminal_manager.ensure(thread_id, PROJECT_ROOT)
    state = session.resize(request.cols, request.rows)
    return TerminalControlResponse(success=True, state=state)


@router.post("/stop", response_model=TerminalControlResponse)
async def stop_terminal(thread_id: str) -> TerminalControlResponse:
    """Stop the thread shell and keep its history available."""
    session = terminal_manager.get(thread_id)
    if session is None:
        return TerminalControlResponse(
            success=True,
            state=TerminalState(
                thread_id=thread_id,
                session_id="",
                status="stopped",
                cwd=str(PROJECT_ROOT),
                started_at=None,
                updated_at=time.time(),
                exit_code=None,
            ),
        )
    state = session.stop()
    return TerminalControlResponse(success=True, state=state)

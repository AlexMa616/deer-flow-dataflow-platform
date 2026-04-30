"""Thread-scoped workflow run persistence, mapping, feedback, and stats."""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from src.sandbox.consts import THREAD_DATA_BASE_DIR

router = APIRouter(prefix="/api/threads/{thread_id}/workflow-runs", tags=["workflows"])
thread_router = APIRouter(prefix="/api/workflow-threads", tags=["workflows"])

WorkflowType = Literal["project", "research", "library", "design", "skills", "automation", "custom"]
WorkflowStatus = Literal["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]
StepStatus = Literal["pending", "running", "completed", "failed", "skipped"]

MAX_RUNS_PER_THREAD = 200
THREAD_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,160}$")
DEFAULT_USER_ID = "local"
_DB_INIT_LOCK = threading.Lock()
_DB_INITIALIZED = False


class WorkflowStep(BaseModel):
    id: str
    label: str
    status: StepStatus = "pending"
    detail: str | None = None


class WorkflowRun(BaseModel):
    id: str
    thread_id: str
    workflow_type: WorkflowType
    title: str
    prompt: str
    status: WorkflowStatus = "queued"
    steps: list[WorkflowStep] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    summary: str | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str
    updated_at: str
    started_at: str | None = None
    completed_at: str | None = None


class WorkflowRunsResponse(BaseModel):
    runs: list[WorkflowRun] = Field(default_factory=list)


class WorkflowRunCreateRequest(BaseModel):
    workflow_type: WorkflowType
    title: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=30_000)
    steps: list[WorkflowStep] = Field(default_factory=list)
    outputs: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    user_id: str | None = Field(default=None, max_length=120)


class WorkflowRunUpdateRequest(BaseModel):
    status: WorkflowStatus | None = None
    steps: list[WorkflowStep] | None = None
    outputs: list[str] | None = None
    summary: str | None = Field(default=None, max_length=12_000)
    error: str | None = Field(default=None, max_length=4_000)
    metadata: dict[str, Any] | None = None
    user_id: str | None = Field(default=None, max_length=120)


class WorkflowFeedbackCreateRequest(BaseModel):
    run_id: str | None = None
    rating: int | None = Field(default=None, ge=1, le=5)
    sentiment: Literal["positive", "neutral", "negative"] | None = None
    comment: str | None = Field(default=None, max_length=4_000)
    model_name: str | None = Field(default=None, max_length=120)
    usage: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    user_id: str | None = Field(default=None, max_length=120)


class WorkflowFeedback(BaseModel):
    id: str
    thread_id: str
    run_id: str | None
    rating: int | None
    sentiment: str | None
    comment: str | None
    model_name: str | None
    usage: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: str


class WorkflowThreadMapping(BaseModel):
    thread_id: str
    user_id: str
    project_id: str | None = None
    project_name: str | None = None
    model_name: str | None = None
    title: str | None = None
    last_workflow_type: WorkflowType | None = None
    last_status: WorkflowStatus | None = None
    created_at: str
    updated_at: str


class WorkflowThreadsResponse(BaseModel):
    threads: list[WorkflowThreadMapping] = Field(default_factory=list)


class WorkflowStats(BaseModel):
    thread_id: str
    run_count: int = 0
    status_counts: dict[str, int] = Field(default_factory=dict)
    feedback_count: int = 0
    average_rating: float | None = None
    model_usage: dict[str, int] = Field(default_factory=dict)
    last_activity_at: str | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _validate_thread_id(thread_id: str) -> None:
    if not THREAD_ID_RE.match(thread_id):
        raise HTTPException(status_code=400, detail="Invalid thread id")


def _data_dir() -> Path:
    path = Path.cwd() / THREAD_DATA_BASE_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _db_path() -> Path:
    return _data_dir() / "workflow-runs.sqlite3"


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None, default: Any) -> Any:
    if value is None:
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


@contextmanager
def _db_lock():
    lock_path = _db_path().with_suffix(".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with open(lock_path, "a+", encoding="utf-8") as handle:
        try:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            yield
        finally:
            try:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except Exception:
                pass


@contextmanager
def _connect():
    _ensure_db()
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _ensure_db() -> None:
    global _DB_INITIALIZED
    if _DB_INITIALIZED:
        return

    with _DB_INIT_LOCK:
        if _DB_INITIALIZED:
            return
        path = _db_path()
        with sqlite3.connect(path) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS workflow_runs (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    user_id TEXT NOT NULL DEFAULT 'local',
                    workflow_type TEXT NOT NULL,
                    title TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    status TEXT NOT NULL,
                    steps_json TEXT NOT NULL,
                    outputs_json TEXT NOT NULL,
                    summary TEXT,
                    error TEXT,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    completed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_runs_thread_updated
                    ON workflow_runs(thread_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_updated
                    ON workflow_runs(user_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS workflow_threads (
                    thread_id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL DEFAULT 'local',
                    project_id TEXT,
                    project_name TEXT,
                    model_name TEXT,
                    title TEXT,
                    last_workflow_type TEXT,
                    last_status TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_threads_user_updated
                    ON workflow_threads(user_id, updated_at DESC);

                CREATE TABLE IF NOT EXISTS workflow_feedback (
                    id TEXT PRIMARY KEY,
                    thread_id TEXT NOT NULL,
                    run_id TEXT,
                    user_id TEXT NOT NULL DEFAULT 'local',
                    rating INTEGER,
                    sentiment TEXT,
                    comment TEXT,
                    model_name TEXT,
                    usage_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_workflow_feedback_thread_created
                    ON workflow_feedback(thread_id, created_at DESC);
                """
            )
            _migrate_legacy_json(conn)
            _ensure_thread_mapping_columns(conn)
        _DB_INITIALIZED = True


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {
        row[1]
        for row in conn.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def _ensure_thread_mapping_columns(conn: sqlite3.Connection) -> None:
    _ensure_column(conn, "workflow_threads", "project_id", "TEXT")
    _ensure_column(conn, "workflow_threads", "project_name", "TEXT")
    _ensure_column(conn, "workflow_threads", "model_name", "TEXT")


def _migrate_legacy_json(conn: sqlite3.Connection) -> None:
    """Import old per-thread workflow-runs.json files if the DB has no rows for them."""
    base_dir = _data_dir()
    for legacy_path in base_dir.glob("*/workflow-runs.json"):
        thread_id = legacy_path.parent.name
        if not THREAD_ID_RE.match(thread_id):
            continue
        exists = conn.execute("SELECT 1 FROM workflow_runs WHERE thread_id = ? LIMIT 1", (thread_id,)).fetchone()
        if exists:
            continue
        try:
            raw_runs = json.loads(legacy_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(raw_runs, list):
            continue
        for raw in raw_runs[:MAX_RUNS_PER_THREAD]:
            try:
                run = WorkflowRun.model_validate(raw)
            except Exception:
                continue
            _insert_run(conn, run, DEFAULT_USER_ID)


def _row_to_run(row: sqlite3.Row) -> WorkflowRun:
    return WorkflowRun(
        id=row["id"],
        thread_id=row["thread_id"],
        workflow_type=row["workflow_type"],
        title=row["title"],
        prompt=row["prompt"],
        status=row["status"],
        steps=[WorkflowStep.model_validate(item) for item in _json_loads(row["steps_json"], [])],
        outputs=_json_loads(row["outputs_json"], []),
        summary=row["summary"],
        error=row["error"],
        metadata=_json_loads(row["metadata_json"], {}),
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        started_at=row["started_at"],
        completed_at=row["completed_at"],
    )


def _row_to_feedback(row: sqlite3.Row) -> WorkflowFeedback:
    return WorkflowFeedback(
        id=row["id"],
        thread_id=row["thread_id"],
        run_id=row["run_id"],
        rating=row["rating"],
        sentiment=row["sentiment"],
        comment=row["comment"],
        model_name=row["model_name"],
        usage=_json_loads(row["usage_json"], {}),
        metadata=_json_loads(row["metadata_json"], {}),
        created_at=row["created_at"],
    )


def _row_to_thread(row: sqlite3.Row) -> WorkflowThreadMapping:
    return WorkflowThreadMapping(
        thread_id=row["thread_id"],
        user_id=row["user_id"],
        project_id=row["project_id"],
        project_name=row["project_name"],
        model_name=row["model_name"],
        title=row["title"],
        last_workflow_type=row["last_workflow_type"],
        last_status=row["last_status"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _upsert_thread_mapping(conn: sqlite3.Connection, run: WorkflowRun, user_id: str) -> None:
    existing = conn.execute("SELECT created_at FROM workflow_threads WHERE thread_id = ?", (run.thread_id,)).fetchone()
    created_at = existing["created_at"] if existing else run.created_at
    project_id = run.metadata.get("project_id")
    project_name = run.metadata.get("project_name")
    model_name = run.metadata.get("model_name") or run.metadata.get("agent_model")
    project_id = str(project_id)[:120] if project_id else None
    project_name = str(project_name)[:160] if project_name else None
    model_name = str(model_name)[:120] if model_name else None
    conn.execute(
        """
        INSERT INTO workflow_threads (
            thread_id, user_id, project_id, project_name, model_name,
            title, last_workflow_type, last_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id) DO UPDATE SET
            user_id = excluded.user_id,
            project_id = COALESCE(excluded.project_id, workflow_threads.project_id),
            project_name = COALESCE(excluded.project_name, workflow_threads.project_name),
            model_name = COALESCE(excluded.model_name, workflow_threads.model_name),
            title = excluded.title,
            last_workflow_type = excluded.last_workflow_type,
            last_status = excluded.last_status,
            updated_at = excluded.updated_at
        """,
        (
            run.thread_id,
            user_id,
            project_id,
            project_name,
            model_name,
            run.title,
            run.workflow_type,
            run.status,
            created_at,
            run.updated_at,
        ),
    )


def _insert_run(conn: sqlite3.Connection, run: WorkflowRun, user_id: str) -> None:
    conn.execute(
        """
        INSERT OR REPLACE INTO workflow_runs (
            id, thread_id, user_id, workflow_type, title, prompt, status,
            steps_json, outputs_json, summary, error, metadata_json,
            created_at, updated_at, started_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            run.id,
            run.thread_id,
            user_id,
            run.workflow_type,
            run.title,
            run.prompt,
            run.status,
            _json_dumps([step.model_dump(mode="json") for step in run.steps]),
            _json_dumps(run.outputs),
            run.summary,
            run.error,
            _json_dumps(run.metadata),
            run.created_at,
            run.updated_at,
            run.started_at,
            run.completed_at,
        ),
    )
    _upsert_thread_mapping(conn, run, user_id)


def _mark_steps_for_status(run: WorkflowRun, status: WorkflowStatus) -> list[WorkflowStep]:
    if status == "running":
        started = False
        next_steps: list[WorkflowStep] = []
        for step in run.steps:
            if step.status == "pending" and not started:
                next_steps.append(step.model_copy(update={"status": "running"}))
                started = True
            else:
                next_steps.append(step)
        return next_steps
    if status == "completed":
        return [step.model_copy(update={"status": "completed"}) for step in run.steps]
    if status == "failed":
        return [step.model_copy(update={"status": "failed" if step.status == "running" else step.status}) for step in run.steps]
    return run.steps


@router.get("", response_model=WorkflowRunsResponse)
async def list_workflow_runs(thread_id: str) -> WorkflowRunsResponse:
    """List persisted workflow runs for a thread."""
    _validate_thread_id(thread_id)
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM workflow_runs
            WHERE thread_id = ?
            ORDER BY updated_at DESC
            LIMIT ?
            """,
            (thread_id, MAX_RUNS_PER_THREAD),
        ).fetchall()
    return WorkflowRunsResponse(runs=[_row_to_run(row) for row in rows])


@router.get("/stats", response_model=WorkflowStats)
async def get_workflow_stats(thread_id: str) -> WorkflowStats:
    """Return aggregate workflow and feedback stats for a thread."""
    _validate_thread_id(thread_id)
    with _connect() as conn:
        status_rows = conn.execute(
            "SELECT status, COUNT(*) AS count FROM workflow_runs WHERE thread_id = ? GROUP BY status",
            (thread_id,),
        ).fetchall()
        last_row = conn.execute(
            "SELECT MAX(updated_at) AS last_activity_at, COUNT(*) AS run_count FROM workflow_runs WHERE thread_id = ?",
            (thread_id,),
        ).fetchone()
        feedback_rows = conn.execute(
            "SELECT rating, model_name, usage_json FROM workflow_feedback WHERE thread_id = ?",
            (thread_id,),
        ).fetchall()

    ratings = [row["rating"] for row in feedback_rows if row["rating"] is not None]
    model_usage: dict[str, int] = {}
    for row in feedback_rows:
        model_name = row["model_name"]
        if model_name:
            model_usage[model_name] = model_usage.get(model_name, 0) + 1
        usage = _json_loads(row["usage_json"], {})
        for key in ("input_tokens", "output_tokens", "total_tokens"):
            value = usage.get(key)
            if isinstance(value, int):
                model_usage[key] = model_usage.get(key, 0) + value

    return WorkflowStats(
        thread_id=thread_id,
        run_count=int(last_row["run_count"] or 0),
        status_counts={row["status"]: int(row["count"]) for row in status_rows},
        feedback_count=len(feedback_rows),
        average_rating=round(sum(ratings) / len(ratings), 2) if ratings else None,
        model_usage=model_usage,
        last_activity_at=last_row["last_activity_at"],
    )


@router.post("", response_model=WorkflowRun)
async def create_workflow_run(thread_id: str, payload: WorkflowRunCreateRequest) -> WorkflowRun:
    """Create a workflow run record before submitting work to the agent."""
    _validate_thread_id(thread_id)
    timestamp = _now()
    user_id = payload.user_id or DEFAULT_USER_ID
    run = WorkflowRun(
        id=str(uuid.uuid4()),
        thread_id=thread_id,
        workflow_type=payload.workflow_type,
        title=payload.title,
        prompt=payload.prompt,
        steps=payload.steps,
        outputs=payload.outputs,
        metadata=payload.metadata,
        created_at=timestamp,
        updated_at=timestamp,
    )
    with _db_lock(), _connect() as conn:
        _insert_run(conn, run, user_id)
    return run


@router.patch("/{run_id}", response_model=WorkflowRun)
async def update_workflow_run(thread_id: str, run_id: str, payload: WorkflowRunUpdateRequest) -> WorkflowRun:
    """Update workflow run status, outputs, or summary."""
    _validate_thread_id(thread_id)
    with _db_lock(), _connect() as conn:
        row = conn.execute(
            "SELECT * FROM workflow_runs WHERE thread_id = ? AND id = ?",
            (thread_id, run_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Workflow run not found")

        run = _row_to_run(row)
        update: dict[str, Any] = {"updated_at": _now()}
        if payload.status is not None:
            update["status"] = payload.status
            if payload.status == "running" and run.started_at is None:
                update["started_at"] = update["updated_at"]
            if payload.status in {"completed", "failed", "cancelled"}:
                update["completed_at"] = update["updated_at"]
        if payload.steps is not None:
            update["steps"] = payload.steps
        elif payload.status is not None:
            update["steps"] = _mark_steps_for_status(run, payload.status)
        if payload.outputs is not None:
            update["outputs"] = payload.outputs
        if payload.summary is not None:
            update["summary"] = payload.summary
        if payload.error is not None:
            update["error"] = payload.error
        if payload.metadata is not None:
            update["metadata"] = {**run.metadata, **payload.metadata}

        updated = run.model_copy(update=update)
        _insert_run(conn, updated, payload.user_id or row["user_id"] or DEFAULT_USER_ID)
        return updated


@router.post("/feedback", response_model=WorkflowFeedback)
async def create_workflow_feedback(thread_id: str, payload: WorkflowFeedbackCreateRequest) -> WorkflowFeedback:
    """Persist model usage and human feedback for a workflow thread."""
    _validate_thread_id(thread_id)
    timestamp = _now()
    feedback = WorkflowFeedback(
        id=str(uuid.uuid4()),
        thread_id=thread_id,
        run_id=payload.run_id,
        rating=payload.rating,
        sentiment=payload.sentiment,
        comment=payload.comment,
        model_name=payload.model_name,
        usage=payload.usage,
        metadata=payload.metadata,
        created_at=timestamp,
    )
    with _db_lock(), _connect() as conn:
        if payload.run_id:
            exists = conn.execute(
                "SELECT 1 FROM workflow_runs WHERE thread_id = ? AND id = ?",
                (thread_id, payload.run_id),
            ).fetchone()
            if exists is None:
                raise HTTPException(status_code=404, detail="Workflow run not found")
        conn.execute(
            """
            INSERT INTO workflow_feedback (
                id, thread_id, run_id, user_id, rating, sentiment, comment,
                model_name, usage_json, metadata_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                feedback.id,
                feedback.thread_id,
                feedback.run_id,
                payload.user_id or DEFAULT_USER_ID,
                feedback.rating,
                feedback.sentiment,
                feedback.comment,
                feedback.model_name,
                _json_dumps(feedback.usage),
                _json_dumps(feedback.metadata),
                feedback.created_at,
            ),
        )
    return feedback


@router.get("/feedback", response_model=list[WorkflowFeedback])
async def list_workflow_feedback(thread_id: str, run_id: str | None = None) -> list[WorkflowFeedback]:
    """List feedback records for a thread or a single run."""
    _validate_thread_id(thread_id)
    query = "SELECT * FROM workflow_feedback WHERE thread_id = ?"
    params: list[Any] = [thread_id]
    if run_id:
        query += " AND run_id = ?"
        params.append(run_id)
    query += " ORDER BY created_at DESC"
    with _connect() as conn:
        rows = conn.execute(query, params).fetchall()
    return [_row_to_feedback(row) for row in rows]


@thread_router.get("", response_model=WorkflowThreadsResponse)
async def list_workflow_threads(
    user_id: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=80, ge=1, le=300),
) -> WorkflowThreadsResponse:
    """List thread mappings ordered by recent workflow activity."""
    with _connect() as conn:
        if user_id:
            rows = conn.execute(
                """
                SELECT * FROM workflow_threads
                WHERE user_id = ?
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT * FROM workflow_threads
                ORDER BY updated_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
    return WorkflowThreadsResponse(threads=[_row_to_thread(row) for row in rows])

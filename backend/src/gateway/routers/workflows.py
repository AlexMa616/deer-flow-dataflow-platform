"""Thread-scoped workflow run persistence."""

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.sandbox.consts import THREAD_DATA_BASE_DIR

router = APIRouter(prefix="/api/threads/{thread_id}/workflow-runs", tags=["workflows"])

WorkflowType = Literal["project", "research", "library", "design", "skills", "automation", "custom"]
WorkflowStatus = Literal["queued", "running", "waiting_approval", "completed", "failed", "cancelled"]
StepStatus = Literal["pending", "running", "completed", "failed", "skipped"]

MAX_RUNS_PER_THREAD = 80
THREAD_ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,160}$")


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


class WorkflowRunUpdateRequest(BaseModel):
    status: WorkflowStatus | None = None
    steps: list[WorkflowStep] | None = None
    outputs: list[str] | None = None
    summary: str | None = Field(default=None, max_length=12_000)
    error: str | None = Field(default=None, max_length=4_000)
    metadata: dict[str, Any] | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _thread_dir(thread_id: str) -> Path:
    if not THREAD_ID_RE.match(thread_id):
        raise HTTPException(status_code=400, detail="Invalid thread id")
    return Path.cwd() / THREAD_DATA_BASE_DIR / thread_id


def _store_path(thread_id: str) -> Path:
    return _thread_dir(thread_id) / "workflow-runs.json"


def _read_runs(thread_id: str) -> list[WorkflowRun]:
    path = _store_path(thread_id)
    if not path.exists():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail="Workflow run store is unreadable") from exc
    if not isinstance(raw, list):
        raise HTTPException(status_code=500, detail="Workflow run store is invalid")
    return [WorkflowRun.model_validate(item) for item in raw]


def _write_runs(thread_id: str, runs: list[WorkflowRun]) -> None:
    thread_dir = _thread_dir(thread_id)
    thread_dir.mkdir(parents=True, exist_ok=True)
    path = _store_path(thread_id)
    tmp_path = path.with_suffix(".json.tmp")
    payload = [run.model_dump(mode="json") for run in runs[:MAX_RUNS_PER_THREAD]]
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_path.replace(path)


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
    return WorkflowRunsResponse(runs=_read_runs(thread_id))


@router.post("", response_model=WorkflowRun)
async def create_workflow_run(thread_id: str, payload: WorkflowRunCreateRequest) -> WorkflowRun:
    """Create a workflow run record before submitting work to the agent."""
    timestamp = _now()
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
    runs = [run, *_read_runs(thread_id)]
    _write_runs(thread_id, runs)
    return run


@router.patch("/{run_id}", response_model=WorkflowRun)
async def update_workflow_run(thread_id: str, run_id: str, payload: WorkflowRunUpdateRequest) -> WorkflowRun:
    """Update workflow run status, outputs, or summary."""
    runs = _read_runs(thread_id)
    for index, run in enumerate(runs):
        if run.id != run_id:
            continue

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
        runs[index] = updated
        _write_runs(thread_id, runs)
        return updated

    raise HTTPException(status_code=404, detail="Workflow run not found")

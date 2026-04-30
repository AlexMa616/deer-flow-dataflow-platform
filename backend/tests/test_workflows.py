"""Tests for workflow persistence, thread mapping, feedback, and stats."""

from __future__ import annotations

import asyncio

import pytest

from src.gateway.routers import workflows


@pytest.fixture(autouse=True)
def isolated_workflow_store(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    workflows._DB_INITIALIZED = False
    yield
    workflows._DB_INITIALIZED = False


def test_workflow_run_persists_to_sqlite_and_updates_stats():
    asyncio.run(_exercise_workflow_store())


async def _exercise_workflow_store():
    thread_id = "thread-1"

    run = await workflows.create_workflow_run(
        thread_id,
        workflows.WorkflowRunCreateRequest(
            workflow_type="project",
            title="Project plan",
            prompt="Plan this project",
            steps=[workflows.WorkflowStep(id="scope", label="Scope")],
            user_id="user-1",
        ),
    )
    assert run.status == "queued"

    updated = await workflows.update_workflow_run(
        thread_id,
        run.id,
        workflows.WorkflowRunUpdateRequest(status="completed", summary="Done"),
    )
    assert updated.status == "completed"
    assert updated.steps[0].status == "completed"
    assert updated.completed_at is not None

    feedback = await workflows.create_workflow_feedback(
        thread_id,
        workflows.WorkflowFeedbackCreateRequest(
            run_id=run.id,
            rating=5,
            sentiment="positive",
            model_name="gpt-test",
            usage={"input_tokens": 10, "output_tokens": 20, "total_tokens": 30},
        ),
    )
    assert feedback.rating == 5

    response = await workflows.list_workflow_runs(thread_id)
    assert len(response.runs) == 1
    assert response.runs[0].id == run.id

    stats = await workflows.get_workflow_stats(thread_id)
    assert stats.run_count == 1
    assert stats.status_counts["completed"] == 1
    assert stats.feedback_count == 1
    assert stats.average_rating == 5
    assert stats.model_usage["gpt-test"] == 1
    assert stats.model_usage["total_tokens"] == 30

    threads = await workflows.list_workflow_threads(user_id="user-1", limit=80)
    assert len(threads.threads) == 1
    assert threads.threads[0].thread_id == thread_id
    assert threads.threads[0].last_status == "completed"

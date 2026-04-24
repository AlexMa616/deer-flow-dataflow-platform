import json
import os
import threading
from datetime import UTC, datetime
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langgraph.runtime import Runtime

from src.transcript import (
    build_transcript_message_key,
    get_transcript_archive_path,
    load_transcript_entries,
    serialize_transcript_message,
)


class TranscriptArchiveMiddlewareState(AgentState):
    """Compatible transcript archiving middleware state."""


class TranscriptArchiveMiddleware(AgentMiddleware[TranscriptArchiveMiddlewareState]):
    """Persist raw thread messages so users can inspect full history later."""

    state_schema = TranscriptArchiveMiddlewareState

    def __init__(self, base_dir: str | None = None):
        super().__init__()
        self._base_dir = base_dir or os.getcwd()
        self._lock = threading.Lock()
        self._seen_keys_by_thread: dict[str, set[str]] = {}

    def _get_seen_keys(self, thread_id: str) -> set[str]:
        seen = self._seen_keys_by_thread.get(thread_id)
        if seen is not None:
            return seen

        archive_path = get_transcript_archive_path(self._base_dir, thread_id)
        loaded = {
            entry.get("key")
            for entry in load_transcript_entries(archive_path)
            if isinstance(entry.get("key"), str)
        }
        seen = {key for key in loaded if isinstance(key, str)}
        self._seen_keys_by_thread[thread_id] = seen
        return seen

    def _archive_messages(self, thread_id: str, phase: str, messages: list) -> None:
        if not messages:
            return

        archive_path = get_transcript_archive_path(self._base_dir, thread_id)
        archive_path.parent.mkdir(parents=True, exist_ok=True)

        with self._lock:
            seen = self._get_seen_keys(thread_id)
            new_entries: list[str] = []

            for message in messages:
                payload = serialize_transcript_message(message)
                key = build_transcript_message_key(payload)
                if key in seen:
                    continue

                seen.add(key)
                new_entries.append(
                    json.dumps(
                        {
                            "key": key,
                            "captured_at": datetime.now(UTC).isoformat(),
                            "phase": phase,
                            "message": payload,
                        },
                        ensure_ascii=False,
                    )
                )

            if not new_entries:
                return

            with archive_path.open("a", encoding="utf-8") as handle:
                handle.write("\n".join(new_entries) + "\n")

    @override
    def before_model(self, state: TranscriptArchiveMiddlewareState, runtime: Runtime) -> dict | None:
        thread_id = runtime.context.get("thread_id")
        if not thread_id:
            return None
        self._archive_messages(thread_id, "before_model", list(state.get("messages", [])))
        return None

    @override
    async def abefore_model(self, state: TranscriptArchiveMiddlewareState, runtime: Runtime) -> dict | None:
        return self.before_model(state, runtime)

    @override
    def after_model(self, state: TranscriptArchiveMiddlewareState, runtime: Runtime) -> dict | None:
        thread_id = runtime.context.get("thread_id")
        if not thread_id:
            return None
        self._archive_messages(thread_id, "after_model", list(state.get("messages", [])))
        return None

    @override
    async def aafter_model(self, state: TranscriptArchiveMiddlewareState, runtime: Runtime) -> dict | None:
        return self.after_model(state, runtime)

    @override
    def after_agent(self, state: TranscriptArchiveMiddlewareState, runtime: Runtime) -> dict | None:
        thread_id = runtime.context.get("thread_id")
        if not thread_id:
            return None
        self._archive_messages(thread_id, "after_agent", list(state.get("messages", [])))
        return None

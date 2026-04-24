from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

from langgraph.config import get_stream_writer

MAX_SUMMARY_CHARS = 120
MAX_PREVIEW_CHARS = 240


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _normalize_text(value: Any, limit: int) -> str:
    if value is None:
        return ""

    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False)
        except TypeError:
            text = str(value)

    text = " ".join(text.split()).strip()
    if len(text) <= limit:
        return text
    return f"{text[: limit - 1]}…"


def _emit(payload: dict[str, Any]) -> None:
    try:
        writer = get_stream_writer()
    except RuntimeError:
        return

    try:
        writer(payload)
    except Exception:
        return


def emit_tool_start(
    tool_name: str,
    *,
    tool_call_id: str | None = None,
    summary: str | None = None,
    command: str | None = None,
    path: str | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": "tool_start",
        "tool_name": tool_name,
        "created_at": _now_iso(),
    }
    if tool_call_id:
        payload["tool_call_id"] = tool_call_id
    if normalized_summary := _normalize_text(summary, MAX_SUMMARY_CHARS):
        payload["summary"] = normalized_summary
    if normalized_command := _normalize_text(command, MAX_PREVIEW_CHARS):
        payload["command"] = normalized_command
    if normalized_path := _normalize_text(path, MAX_PREVIEW_CHARS):
        payload["path"] = normalized_path

    _emit(payload)


def emit_tool_result(
    tool_name: str,
    *,
    tool_call_id: str | None = None,
    summary: str | None = None,
    preview: Any = None,
    command: str | None = None,
    path: str | None = None,
    duration_ms: float | int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": "tool_result",
        "tool_name": tool_name,
        "created_at": _now_iso(),
    }
    if tool_call_id:
        payload["tool_call_id"] = tool_call_id
    if normalized_summary := _normalize_text(summary, MAX_SUMMARY_CHARS):
        payload["summary"] = normalized_summary
    if normalized_preview := _normalize_text(preview, MAX_PREVIEW_CHARS):
        payload["preview"] = normalized_preview
    if normalized_command := _normalize_text(command, MAX_PREVIEW_CHARS):
        payload["command"] = normalized_command
    if normalized_path := _normalize_text(path, MAX_PREVIEW_CHARS):
        payload["path"] = normalized_path
    if duration_ms is not None:
        payload["duration_ms"] = int(duration_ms)

    _emit(payload)


def emit_tool_error(
    tool_name: str,
    *,
    tool_call_id: str | None = None,
    summary: str | None = None,
    error: Any = None,
    command: str | None = None,
    path: str | None = None,
    duration_ms: float | int | None = None,
) -> None:
    payload: dict[str, Any] = {
        "type": "tool_error",
        "tool_name": tool_name,
        "created_at": _now_iso(),
    }
    if tool_call_id:
        payload["tool_call_id"] = tool_call_id
    if normalized_summary := _normalize_text(summary, MAX_SUMMARY_CHARS):
        payload["summary"] = normalized_summary
    if normalized_error := _normalize_text(error, MAX_PREVIEW_CHARS):
        payload["error"] = normalized_error
    if normalized_command := _normalize_text(command, MAX_PREVIEW_CHARS):
        payload["command"] = normalized_command
    if normalized_path := _normalize_text(path, MAX_PREVIEW_CHARS):
        payload["path"] = normalized_path
    if duration_ms is not None:
        payload["duration_ms"] = int(duration_ms)

    _emit(payload)

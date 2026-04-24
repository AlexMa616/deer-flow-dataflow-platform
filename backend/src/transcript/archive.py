import hashlib
import json
from pathlib import Path
from typing import Any

from src.sandbox.consts import THREAD_DATA_BASE_DIR

TRANSCRIPT_ARCHIVE_FILENAME = "full-transcript.jsonl"


def get_transcript_archive_path(base_dir: str | Path, thread_id: str) -> Path:
    return Path(base_dir) / THREAD_DATA_BASE_DIR / thread_id / TRANSCRIPT_ARCHIVE_FILENAME


def serialize_transcript_message(message: Any) -> dict[str, Any]:
    if hasattr(message, "model_dump"):
        payload = message.model_dump(mode="json")
        if isinstance(payload, dict):
            return payload
    if isinstance(message, dict):
        return message
    return {
        "type": getattr(message, "type", None),
        "name": getattr(message, "name", None),
        "content": str(message),
    }


def build_transcript_message_key(payload: dict[str, Any]) -> str:
    message_id = payload.get("id")
    if isinstance(message_id, str) and message_id:
        return f"id:{message_id}"

    tool_call_id = payload.get("tool_call_id")
    if isinstance(tool_call_id, str) and tool_call_id:
        return f"tool:{tool_call_id}:{payload.get('name') or ''}"

    normalized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    return f"sha256:{digest}"


def load_transcript_entries(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []

    entries: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            entries.append(parsed)
    return entries

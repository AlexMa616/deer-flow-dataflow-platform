from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from src.transcript import get_transcript_archive_path, load_transcript_entries

router = APIRouter(prefix="/api", tags=["transcript"])


class TranscriptEntry(BaseModel):
    key: str
    captured_at: str
    phase: str
    message: dict[str, Any]


class TranscriptResponse(BaseModel):
    entries: list[TranscriptEntry] = Field(default_factory=list)


@router.get(
    "/threads/{thread_id}/transcript",
    response_model=TranscriptResponse,
    summary="Get Full Transcript Archive",
    description="Return archived raw thread messages captured before summarization trims visible state.",
)
async def get_thread_transcript(thread_id: str) -> TranscriptResponse:
    archive_path = get_transcript_archive_path(".", thread_id)
    entries = load_transcript_entries(archive_path)
    return TranscriptResponse(entries=[TranscriptEntry.model_validate(entry) for entry in entries])

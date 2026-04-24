from pathlib import Path
from typing import Literal

import anyio
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from src.agents.memory.updater import get_memory_data
from src.agents.middlewares.thread_data_middleware import THREAD_DATA_BASE_DIR
from src.vector import VectorSearchResult, get_vector_index, index_memory

router = APIRouter(prefix="/api", tags=["semantic"])


class SemanticSearchResult(BaseModel):
    score: float
    source: str
    thread_id: str
    filename: str
    chunk_index: int
    excerpt: str
    metadata: dict = Field(default_factory=dict)
    citation: dict = Field(default_factory=dict)


class SemanticSearchResponse(BaseModel):
    query: str
    results: list[SemanticSearchResult]


class SemanticReindexRequest(BaseModel):
    source: Literal["all", "upload", "memory"] = "all"
    thread_id: str | None = None


class SemanticReindexResponse(BaseModel):
    indexed: int
    source: str
    thread_id: str | None = None


_TEXT_SOURCE_SUFFIXES = {
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".xml",
    ".html",
    ".htm",
}

_DOC_CONVERTIBLE_SUFFIXES = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
}


def _result_identity(result: VectorSearchResult) -> tuple[str, str, str, int]:
    return (
        result.source,
        result.thread_id,
        result.filename,
        result.chunk_index,
    )


def _merge_results(results: list[VectorSearchResult], top_k: int) -> list[VectorSearchResult]:
    deduped: dict[tuple[str, str, str, int], VectorSearchResult] = {}
    for item in results:
        key = _result_identity(item)
        previous = deduped.get(key)
        if previous is None or item.score > previous.score:
            deduped[key] = item
    ordered = sorted(deduped.values(), key=lambda item: item.score, reverse=True)
    return ordered[:top_k]


def _is_generated_markdown(upload_path: Path) -> bool:
    if upload_path.suffix.lower() != ".md":
        return False
    stem = upload_path.stem
    uploads_dir = upload_path.parent
    for suffix in _DOC_CONVERTIBLE_SUFFIXES:
        if (uploads_dir / f"{stem}{suffix}").exists():
            return True
    return False


@router.get(
    "/semantic/search",
    response_model=SemanticSearchResponse,
    summary="Semantic Search",
    description="Search uploads and memory using vector embeddings and return citations.",
)
async def semantic_search(
    query: str = Query(..., min_length=2),
    thread_id: str | None = Query(default=None),
    source: str | None = Query(default=None),
    top_k: int = Query(default=5, ge=1, le=20),
) -> SemanticSearchResponse:
    index = get_vector_index()
    normalized_source = None if source in (None, "all") else source
    results = index.search(
        query=query,
        top_k=top_k,
        thread_id=thread_id,
        source=normalized_source,
    )
    if thread_id and (normalized_source is None or normalized_source == "memory"):
        memory_results = index.search(query=query, top_k=top_k, source="memory")
        results = _merge_results(results + memory_results, top_k=top_k)
    payload = []
    for result in results:
        excerpt = result.content[:280].replace("\n", " ").strip()
        payload.append(
            SemanticSearchResult(
                score=result.score,
                source=result.source,
                thread_id=result.thread_id,
                filename=result.filename,
                chunk_index=result.chunk_index,
                excerpt=excerpt,
                metadata=result.metadata,
                citation=result.citation,
            )
        )
    return SemanticSearchResponse(query=query, results=payload)


def _extract_upload_text(upload_path: Path) -> str:
    try:
        markdown_path = upload_path.with_suffix(".md")
        if markdown_path.exists() and markdown_path != upload_path:
            return markdown_path.read_text(encoding="utf-8", errors="replace")

        if upload_path.suffix.lower() in _TEXT_SOURCE_SUFFIXES:
            return upload_path.read_text(encoding="utf-8", errors="replace")

        content = upload_path.read_bytes()
        if b"\x00" in content:
            return ""
        return content.decode("utf-8", errors="replace")
    except OSError:
        return ""


def _iter_thread_dirs(thread_id: str | None) -> list[Path]:
    base_dir = Path.cwd() / THREAD_DATA_BASE_DIR
    if thread_id:
        return [base_dir / thread_id]
    if not base_dir.exists():
        return []
    return [path for path in base_dir.iterdir() if path.is_dir()]


def _reindex_semantic_sync(request: SemanticReindexRequest) -> int:
    index = get_vector_index()
    indexed = 0

    if request.source in ("all", "memory"):
        memory_data = get_memory_data()
        indexed += index_memory(memory_data)

    if request.source in ("all", "upload"):
        for thread_dir in _iter_thread_dirs(request.thread_id):
            if not thread_dir.exists() or not thread_dir.is_dir():
                continue
            thread_id = thread_dir.name
            uploads_dir = thread_dir / "user-data" / "uploads"
            if not uploads_dir.exists():
                continue
            for upload_path in sorted(uploads_dir.iterdir()):
                if (
                    not upload_path.is_file()
                    or upload_path.name.startswith(".")
                    or _is_generated_markdown(upload_path)
                ):
                    continue
                content = _extract_upload_text(upload_path)
                if not content:
                    continue
                metadata = {
                    "path": f"/mnt/user-data/uploads/{upload_path.name}",
                    "artifact_url": f"/api/threads/{thread_id}/artifacts/mnt/user-data/uploads/{upload_path.name}",
                }
                indexed += index.index_text(
                    source="upload",
                    thread_id=thread_id,
                    filename=upload_path.name,
                    text=content,
                    metadata=metadata,
                    incremental=True,
                )
    return indexed


@router.post(
    "/semantic/reindex",
    response_model=SemanticReindexResponse,
    summary="Reindex semantic vectors",
    description="Rebuild vector index for uploads and/or memory.",
)
async def semantic_reindex(request: SemanticReindexRequest) -> SemanticReindexResponse:
    indexed = await anyio.to_thread.run_sync(_reindex_semantic_sync, request)
    return SemanticReindexResponse(indexed=indexed, source=request.source, thread_id=request.thread_id)

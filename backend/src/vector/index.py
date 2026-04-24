import hashlib
import json
import math
import os
import uuid
from collections.abc import Iterable, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

import duckdb

from src.config import get_uploads_config, get_vector_config
from src.embeddings.factory import create_embeddings


@dataclass
class VectorDocument:
    source: str
    thread_id: str
    filename: str
    content: str
    metadata: dict[str, Any]
    chunk_index: int = 0
    chunk_hash: str | None = None
    doc_id: str | None = None


@dataclass
class VectorSearchResult:
    score: float
    source: str
    thread_id: str
    filename: str
    chunk_index: int
    content: str
    metadata: dict[str, Any]
    citation: dict[str, Any]


def _get_storage_path() -> Path:
    config = get_vector_config()
    return Path(os.getcwd()) / config.storage_path


def _ensure_schema(conn: duckdb.DuckDBPyConnection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            source TEXT,
            thread_id TEXT,
            filename TEXT,
            chunk_index INTEGER,
            chunk_hash TEXT,
            content TEXT,
            metadata JSON,
            embedding TEXT
        )
        """
    )


def _ensure_column(conn: duckdb.DuckDBPyConnection, column: str, column_type: str) -> None:
    rows = conn.execute("PRAGMA table_info('documents')").fetchall()
    columns = {row[1] for row in rows}
    if column not in columns:
        conn.execute(f"ALTER TABLE documents ADD COLUMN {column} {column_type}")


def _chunk_text(text: str, chunk_size: int, overlap: int) -> list[str]:
    if not text:
        return []
    if chunk_size <= 0:
        return [text]
    overlap = min(overlap, max(chunk_size - 1, 0))
    chunks: list[str] = []
    start = 0
    text_len = len(text)
    while start < text_len:
        end = min(start + chunk_size, text_len)
        chunks.append(text[start:end])
        if end >= text_len:
            break
        start = max(0, end - overlap)
    return chunks


def _cosine_similarity(a: Iterable[float], b: Iterable[float]) -> float:
    a_list = list(a)
    b_list = list(b)
    if not a_list or not b_list or len(a_list) != len(b_list):
        return 0.0
    dot = sum(x * y for x, y in zip(a_list, b_list))
    norm_a = math.sqrt(sum(x * x for x in a_list))
    norm_b = math.sqrt(sum(y * y for y in b_list))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


class VectorIndex:
    def __init__(self):
        self._config = get_vector_config()
        self._uploads_config = get_uploads_config()
        self._embeddings = create_embeddings()

    def _connect(self) -> duckdb.DuckDBPyConnection:
        storage_path = _get_storage_path()
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        conn = duckdb.connect(str(storage_path))
        _ensure_schema(conn)
        _ensure_column(conn, "chunk_hash", "TEXT")
        return conn

    def _embed_documents(self, texts: list[str]) -> list[list[float]]:
        if self._embeddings is None:
            return []
        if not texts:
            return []

        batch_size = max(1, self._config.batch_size)
        batches = [texts[i : i + batch_size] for i in range(0, len(texts), batch_size)]
        if len(batches) == 1:
            return self._embeddings.embed_documents(texts)

        use_parallel = (
            self._config.parallel_workers > 1
            and len(texts) >= self._config.parallel_min_chunks
        )
        if not use_parallel:
            embeddings: list[list[float]] = []
            for batch in batches:
                embeddings.extend(self._embeddings.embed_documents(batch))
            return embeddings

        with ThreadPoolExecutor(max_workers=self._config.parallel_workers) as executor:
            results = list(executor.map(self._embeddings.embed_documents, batches))

        embeddings: list[list[float]] = []
        for batch_embeddings in results:
            embeddings.extend(batch_embeddings)
        return embeddings

    def _embed_query(self, text: str) -> list[float]:
        if self._embeddings is None:
            return []
        return self._embeddings.embed_query(text)

    def _fetch_existing_hashes(
        self,
        *,
        source: str,
        thread_id: str,
        filename: str,
    ) -> dict[str, str]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT chunk_hash, id FROM documents WHERE source = ? AND thread_id = ? AND filename = ?",
                [source, thread_id, filename],
            ).fetchall()
        return {row[0]: row[1] for row in rows if row[0]}

    def _delete_hashes(
        self,
        *,
        source: str,
        thread_id: str,
        filename: str,
        hashes: Sequence[str],
    ) -> None:
        if not hashes:
            return
        with self._connect() as conn:
            for i in range(0, len(hashes), 200):
                batch = list(hashes[i : i + 200])
                placeholders = ", ".join(["?"] * len(batch))
                conn.execute(
                    f"DELETE FROM documents WHERE source = ? AND thread_id = ? AND filename = ? AND chunk_hash IN ({placeholders})",
                    [source, thread_id, filename, *batch],
                )

    def _update_chunk_indices(
        self,
        *,
        source: str,
        thread_id: str,
        filename: str,
        index_map: dict[str, int],
    ) -> None:
        if not index_map:
            return
        updates = [
            (index, source, thread_id, filename, chunk_hash)
            for chunk_hash, index in index_map.items()
        ]
        with self._connect() as conn:
            conn.executemany(
                "UPDATE documents SET chunk_index = ? WHERE source = ? AND thread_id = ? AND filename = ? AND chunk_hash = ?",
                updates,
            )

    def clear_source(self, source: str, thread_id: str | None = None, filename: str | None = None) -> None:
        if not self._config.enabled or self._embeddings is None:
            return
        with self._connect() as conn:
            query = "DELETE FROM documents WHERE source = ?"
            params: list[Any] = [source]
            if thread_id:
                query += " AND thread_id = ?"
                params.append(thread_id)
            if filename:
                query += " AND filename = ?"
                params.append(filename)
            conn.execute(query, params)

    def add_documents(self, docs: list[VectorDocument]) -> int:
        if not self._config.enabled or self._embeddings is None:
            return 0
        if not docs:
            return 0

        texts = [doc.content for doc in docs]
        embeddings = self._embed_documents(texts)
        if not embeddings:
            return 0

        now = datetime.utcnow().isoformat() + "Z"
        rows = []
        for doc, embedding in zip(docs, embeddings):
            doc_id = doc.doc_id or f"doc_{uuid.uuid4().hex[:10]}"
            metadata = {**doc.metadata, "indexed_at": now}
            rows.append(
                (
                    doc_id,
                    doc.source,
                    doc.thread_id,
                    doc.filename,
                    doc.chunk_index,
                    doc.chunk_hash,
                    doc.content,
                    json.dumps(metadata, ensure_ascii=False),
                    json.dumps(embedding),
                )
            )

        with self._connect() as conn:
            conn.executemany(
                "INSERT OR REPLACE INTO documents (id, source, thread_id, filename, chunk_index, chunk_hash, content, metadata, embedding) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
        return len(rows)

    def index_text(
        self,
        *,
        source: str,
        thread_id: str,
        filename: str,
        text: str,
        metadata: dict[str, Any],
        incremental: bool | None = None,
        dedupe: bool | None = None,
    ) -> int:
        if not self._config.enabled or self._embeddings is None:
            return 0
        if not text.strip():
            return 0

        chunk_size = self._uploads_config.chunk_chars
        overlap = self._uploads_config.chunk_overlap
        max_chunks = self._uploads_config.max_chunks

        chunks = _chunk_text(text, chunk_size, overlap)[:max_chunks]
        if not chunks:
            return 0

        use_incremental = self._config.incremental if incremental is None else incremental
        use_dedupe = self._config.dedupe if dedupe is None else dedupe

        chunk_entries: list[tuple[int, str, str]] = []
        seen_hashes: set[str] = set()
        for idx, chunk in enumerate(chunks):
            chunk_hash = _hash_text(chunk)
            if use_dedupe and chunk_hash in seen_hashes:
                continue
            seen_hashes.add(chunk_hash)
            chunk_entries.append((idx, chunk, chunk_hash))

        if not chunk_entries:
            return 0

        existing_hashes: set[str] = set()
        if use_incremental:
            existing = self._fetch_existing_hashes(
                source=source,
                thread_id=thread_id,
                filename=filename,
            )
            existing_hashes = set(existing.keys())
            index_map = {chunk_hash: idx for idx, _, chunk_hash in chunk_entries if chunk_hash in existing_hashes}
            if index_map:
                self._update_chunk_indices(
                    source=source,
                    thread_id=thread_id,
                    filename=filename,
                    index_map=index_map,
                )
            to_remove = existing_hashes - set(seen_hashes)
            if to_remove:
                self._delete_hashes(
                    source=source,
                    thread_id=thread_id,
                    filename=filename,
                    hashes=list(to_remove),
                )
        else:
            self.clear_source(source, thread_id=thread_id, filename=filename)

        to_add = [entry for entry in chunk_entries if entry[2] not in existing_hashes]
        if not to_add:
            return 0

        docs: list[VectorDocument] = []
        for idx, chunk, chunk_hash in to_add:
            docs.append(
                VectorDocument(
                    source=source,
                    thread_id=thread_id,
                    filename=filename,
                    content=chunk,
                    metadata={**metadata, "chunk_hash": chunk_hash},
                    chunk_index=idx,
                    chunk_hash=chunk_hash,
                )
            )
        return self.add_documents(docs)

    def search(
        self,
        *,
        query: str,
        top_k: int = 5,
        thread_id: str | None = None,
        source: str | None = None,
    ) -> list[VectorSearchResult]:
        if not self._config.enabled or self._embeddings is None:
            return []

        query_embedding = self._embed_query(query)
        if not query_embedding:
            return []

        with self._connect() as conn:
            sql = "SELECT source, thread_id, filename, chunk_index, content, metadata, embedding FROM documents"
            params: list[Any] = []
            filters = []
            if thread_id:
                filters.append("thread_id = ?")
                params.append(thread_id)
            if source:
                filters.append("source = ?")
                params.append(source)
            if filters:
                sql += " WHERE " + " AND ".join(filters)
            rows = conn.execute(sql, params).fetchall()

        results: list[VectorSearchResult] = []
        for row in rows:
            meta = json.loads(row[5]) if row[5] else {}
            embedding = json.loads(row[6]) if row[6] else []
            score = _cosine_similarity(query_embedding, embedding)
            citation = {
                "source": row[0],
                "thread_id": row[1],
                "filename": row[2],
                "chunk_index": row[3],
                "path": meta.get("path"),
                "artifact_url": meta.get("artifact_url"),
            }
            results.append(
                VectorSearchResult(
                    score=score,
                    source=row[0],
                    thread_id=row[1],
                    filename=row[2],
                    chunk_index=row[3],
                    content=row[4],
                    metadata=meta,
                    citation=citation,
                )
            )

        results.sort(key=lambda item: item.score, reverse=True)
        return results[:top_k]


def _build_memory_documents(memory_data: dict[str, Any]) -> list[VectorDocument]:
    docs: list[VectorDocument] = []
    thread_id = "global"
    filename = "memory.json"
    user = memory_data.get("user", {})
    history = memory_data.get("history", {})

    def add_section(section_name: str, section: dict[str, Any]) -> None:
        summary = section.get("summary", "")
        if summary:
            docs.append(
                VectorDocument(
                    source="memory",
                    thread_id=thread_id,
                    filename=filename,
                    content=summary,
                    metadata={"section": section_name},
                )
            )

    add_section("user.workContext", user.get("workContext", {}))
    add_section("user.personalContext", user.get("personalContext", {}))
    add_section("user.topOfMind", user.get("topOfMind", {}))
    add_section("history.recentMonths", history.get("recentMonths", {}))
    add_section("history.earlierContext", history.get("earlierContext", {}))
    add_section("history.longTermBackground", history.get("longTermBackground", {}))

    for fact in memory_data.get("facts", []):
        content = fact.get("content", "")
        if not content:
            continue
        docs.append(
            VectorDocument(
                source="memory",
                thread_id=thread_id,
                filename=filename,
                content=content,
                metadata={
                    "fact_id": fact.get("id"),
                    "category": fact.get("category"),
                    "confidence": fact.get("confidence"),
                },
            )
        )

    return docs


_vector_index: VectorIndex | None = None


def get_vector_index() -> VectorIndex:
    global _vector_index
    if _vector_index is None:
        _vector_index = VectorIndex()
    return _vector_index


def index_memory(memory_data: dict[str, Any]) -> int:
    """Rebuild memory vectors."""
    index = get_vector_index()
    index.clear_source("memory", thread_id="global")
    docs = _build_memory_documents(memory_data)
    return index.add_documents(docs)

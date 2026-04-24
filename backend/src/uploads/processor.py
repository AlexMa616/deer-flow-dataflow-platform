import json
import logging
import os
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from queue import Queue
from typing import Any

from src.agents.middlewares.thread_data_middleware import THREAD_DATA_BASE_DIR
from src.config import get_uploads_config
from src.models import create_chat_model
from src.vector import get_vector_index

from .status_store import append_job_event, get_job_status, list_job_statuses, upsert_job_status

logger = logging.getLogger(__name__)

CONVERTIBLE_EXTENSIONS = {
    ".pdf",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".doc",
    ".docx",
}

ANALYSIS_PROMPT = """You are a content analyst. Summarize the document and extract signals.
Return ONLY valid JSON with this schema:
{{
  "summary": "1-2 sentence summary",
  "keywords": ["keyword1", "keyword2", "..."],
  "language": "ISO language name (e.g., Chinese, English)",
  "highlights": ["short bullet", "short bullet"]
}}
Keep it concise and factual.
Document:
{content}
"""


def _get_uploads_dir(thread_id: str) -> Path:
    return Path(os.getcwd()) / THREAD_DATA_BASE_DIR / thread_id / "user-data" / "uploads"


def _is_text_bytes(content: bytes) -> bool:
    return b"\x00" not in content


def _convert_file_to_markdown(file_path: Path) -> Path | None:
    try:
        from markitdown import MarkItDown

        md = MarkItDown()
        result = md.convert(str(file_path))
        md_path = file_path.with_suffix(".md")
        md_path.write_text(result.text_content, encoding="utf-8")
        return md_path
    except Exception as exc:
        logger.error("Failed to convert %s to markdown: %s", file_path.name, exc, exc_info=True)
        return None


def _parse_analysis_response(response_text: str) -> dict[str, Any]:
    text = response_text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        text = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
    return json.loads(text)


def _fallback_analysis(content: str, max_keywords: int) -> dict[str, Any]:
    preview = content.strip().split("\n")
    summary = preview[0][:300] if preview else ""
    return {
        "summary": summary,
        "keywords": [],
        "language": "Unknown",
        "highlights": preview[1:3] if len(preview) > 1 else [],
    }


def _analyze_text(content: str) -> dict[str, Any]:
    config = get_uploads_config()
    if not config.analysis_enabled:
        return {"summary": "", "keywords": [], "language": "", "highlights": []}

    clipped = content[:8000]
    prompt = ANALYSIS_PROMPT.format(content=clipped)
    try:
        model = create_chat_model(name=config.analysis_model_name, thinking_enabled=False)
        response = model.invoke(prompt)
        data = _parse_analysis_response(str(response.content))
    except Exception as exc:
        logger.warning("Upload analysis failed, using fallback: %s", exc)
        data = _fallback_analysis(content, config.keywords_max)

    data["summary"] = (data.get("summary") or "")[: config.summary_max_chars]
    keywords = data.get("keywords") or []
    data["keywords"] = keywords[: config.keywords_max]
    data["highlights"] = (data.get("highlights") or [])[:5]
    return data


def _extract_text_for_analysis(file_path: Path, markdown_path: Path | None) -> str:
    if markdown_path and markdown_path.exists():
        return markdown_path.read_text(encoding="utf-8", errors="replace")

    try:
        content = file_path.read_bytes()
    except OSError:
        return ""

    if not _is_text_bytes(content):
        return ""
    return content.decode("utf-8", errors="replace")


def _build_steps(file_path: Path) -> dict[str, str]:
    return {
        "convert": "pending" if file_path.suffix.lower() in CONVERTIBLE_EXTENSIONS else "skipped",
        "analyze": "pending",
        "index": "pending",
    }


@dataclass
class UploadJob:
    thread_id: str
    filename: str
    file_path: Path
    job_id: str


class UploadProcessor:
    def __init__(self) -> None:
        self._config = get_uploads_config()
        self._queue: Queue[UploadJob] = Queue()
        self._workers: list[threading.Thread] = []
        self._lock = threading.Lock()
        self._started = False
        self._cancelled: set[tuple[str, str]] = set()

    def start(self) -> None:
        with self._lock:
            if self._started:
                return
            self._started = True
            for index in range(self._config.max_workers):
                worker = threading.Thread(target=self._worker, name=f"upload-worker-{index}", daemon=True)
                worker.start()
                self._workers.append(worker)
            self._rehydrate_pending_jobs()

    def enqueue(self, thread_id: str, filename: str) -> str:
        self.start()
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        file_path = _get_uploads_dir(thread_id) / filename
        steps = _build_steps(file_path)

        upsert_job_status(
            thread_id,
            filename,
            {
                "job_id": job_id,
                "status": "queued",
                "progress": 0,
                "steps": steps,
                "summary": "",
                "keywords": [],
                "language": "",
                "highlights": [],
                "markdown_file": None,
                "error": None,
            },
        )
        append_job_event(thread_id, filename, "已加入处理队列")

        self._queue.put(UploadJob(thread_id=thread_id, filename=filename, file_path=file_path, job_id=job_id))
        return job_id

    def cancel_job(self, thread_id: str, filename: str) -> dict[str, Any] | None:
        self.start()
        status = get_job_status(thread_id, filename)
        if not status:
            return None
        if status.get("status") in {"completed", "failed", "cancelled"}:
            return status
        self._cancelled.add((thread_id, filename))
        updated = self._mark_cancelled(thread_id, filename, status=status, reason="用户取消")
        return updated

    def retry_job(self, thread_id: str, filename: str) -> dict[str, Any] | None:
        self.start()
        status = get_job_status(thread_id, filename)
        if not status:
            return None
        if status.get("status") in {"queued", "processing"}:
            return status

        file_path = _get_uploads_dir(thread_id) / filename
        steps = _build_steps(file_path)
        job_id = f"job_{uuid.uuid4().hex[:10]}"
        self._cancelled.discard((thread_id, filename))
        updated = upsert_job_status(
            thread_id,
            filename,
            {
                "job_id": job_id,
                "status": "queued",
                "progress": 0,
                "steps": steps,
                "summary": "",
                "keywords": [],
                "language": "",
                "highlights": [],
                "markdown_file": None,
                "error": None,
            },
        )
        append_job_event(thread_id, filename, "已重新加入处理队列")
        self._queue.put(UploadJob(thread_id=thread_id, filename=filename, file_path=file_path, job_id=job_id))
        return updated

    def _is_cancelled(self, job: UploadJob) -> bool:
        if (job.thread_id, job.filename) in self._cancelled:
            return True
        status = get_job_status(job.thread_id, job.filename)
        if status and status.get("status") == "cancelled":
            self._cancelled.add((job.thread_id, job.filename))
            return True
        return False

    def _mark_cancelled(
        self,
        thread_id: str,
        filename: str,
        *,
        status: dict[str, Any] | None = None,
        step: str | None = None,
        reason: str = "已取消",
    ) -> dict[str, Any]:
        current = status or get_job_status(thread_id, filename) or {}
        if current.get("status") == "cancelled":
            return current
        steps = dict(current.get("steps", {}))
        if step:
            steps[step] = "cancelled"
        else:
            for key, value in steps.items():
                if value in {"pending", "running"}:
                    steps[key] = "cancelled"
        payload: dict[str, Any] = {"status": "cancelled", "steps": steps}
        if "progress" in current:
            payload["progress"] = current.get("progress", 0)
        payload["error"] = current.get("error") or reason
        updated = upsert_job_status(thread_id, filename, payload)
        append_job_event(thread_id, filename, reason, level="warning")
        return updated

    def _maybe_cancel(self, job: UploadJob, *, step: str | None = None, reason: str = "已取消") -> bool:
        if self._is_cancelled(job):
            self._mark_cancelled(job.thread_id, job.filename, step=step, reason=reason)
            return True
        return False

    def _rehydrate_pending_jobs(self) -> None:
        base_dir = Path(os.getcwd()) / THREAD_DATA_BASE_DIR
        if not base_dir.exists():
            return
        for thread_dir in base_dir.iterdir():
            if not thread_dir.is_dir():
                continue
            thread_id = thread_dir.name
            statuses = list_job_statuses(thread_id)
            for filename, status in statuses.items():
                if status.get("status") in {"queued", "processing"}:
                    file_path = _get_uploads_dir(thread_id) / filename
                    if file_path.exists():
                        job_id = status.get("job_id") or f"job_{uuid.uuid4().hex[:10]}"
                        self._queue.put(UploadJob(thread_id=thread_id, filename=filename, file_path=file_path, job_id=job_id))

    def _worker(self) -> None:
        while True:
            job = self._queue.get()
            try:
                self._process_job(job)
            except Exception as exc:
                logger.error("Upload job failed: %s", exc, exc_info=True)
                upsert_job_status(
                    job.thread_id,
                    job.filename,
                    {"status": "failed", "progress": 100, "error": str(exc)},
                )
                append_job_event(job.thread_id, job.filename, f"处理失败: {exc}", level="error")
            finally:
                self._queue.task_done()

    def _process_job(self, job: UploadJob) -> None:
        if self._maybe_cancel(job, reason="已取消，跳过处理"):
            return

        upsert_job_status(job.thread_id, job.filename, {"status": "processing", "progress": 5})
        append_job_event(job.thread_id, job.filename, "开始处理")

        if self._maybe_cancel(job, reason="处理中被取消"):
            return

        markdown_path: Path | None = None
        if job.file_path.suffix.lower() in CONVERTIBLE_EXTENSIONS:
            upsert_job_status(job.thread_id, job.filename, {"steps": {"convert": "running"}, "progress": 20})
            append_job_event(job.thread_id, job.filename, "格式转换中")
            markdown_path = _convert_file_to_markdown(job.file_path)
            if self._maybe_cancel(job, step="convert", reason="转换中被取消"):
                return
            upsert_job_status(
                job.thread_id,
                job.filename,
                {
                    "steps": {"convert": "completed" if markdown_path else "failed"},
                    "markdown_file": markdown_path.name if markdown_path else None,
                    "progress": 40,
                },
            )
            append_job_event(
                job.thread_id,
                job.filename,
                "格式转换完成" if markdown_path else "格式转换失败",
                level="info" if markdown_path else "error",
            )
        else:
            upsert_job_status(job.thread_id, job.filename, {"steps": {"convert": "skipped"}, "progress": 15})
            append_job_event(job.thread_id, job.filename, "无需格式转换，已跳过")

        if self._maybe_cancel(job, reason="处理中被取消"):
            return

        content = _extract_text_for_analysis(job.file_path, markdown_path)
        if content:
            upsert_job_status(job.thread_id, job.filename, {"steps": {"analyze": "running"}, "progress": 55})
            append_job_event(job.thread_id, job.filename, "内容分析中")
            analysis = _analyze_text(content)
            if self._maybe_cancel(job, step="analyze", reason="分析中被取消"):
                return
            upsert_job_status(
                job.thread_id,
                job.filename,
                {
                    "steps": {"analyze": "completed"},
                    "summary": analysis.get("summary", ""),
                    "keywords": analysis.get("keywords", []),
                    "language": analysis.get("language", ""),
                    "highlights": analysis.get("highlights", []),
                    "progress": 75,
                },
            )
            append_job_event(job.thread_id, job.filename, "内容分析完成")
        else:
            upsert_job_status(job.thread_id, job.filename, {"steps": {"analyze": "skipped"}, "progress": 60})
            append_job_event(job.thread_id, job.filename, "无可读文本，跳过分析")

        if self._maybe_cancel(job, reason="处理中被取消"):
            return

        vector_index = get_vector_index()
        if content:
            upsert_job_status(job.thread_id, job.filename, {"steps": {"index": "running"}, "progress": 85})
            append_job_event(job.thread_id, job.filename, "向量索引中")
            metadata = {
                "path": f"/mnt/user-data/uploads/{job.filename}",
                "artifact_url": f"/api/threads/{job.thread_id}/artifacts/mnt/user-data/uploads/{job.filename}",
                "markdown_file": markdown_path.name if markdown_path else None,
            }
            vector_index.index_text(
                source="upload",
                thread_id=job.thread_id,
                filename=job.filename,
                text=content,
                metadata=metadata,
            )
            if self._maybe_cancel(job, step="index", reason="索引中被取消"):
                return
            upsert_job_status(job.thread_id, job.filename, {"steps": {"index": "completed"}, "progress": 100})
            append_job_event(job.thread_id, job.filename, "向量索引完成")
        else:
            upsert_job_status(job.thread_id, job.filename, {"steps": {"index": "skipped"}, "progress": 100})
            append_job_event(job.thread_id, job.filename, "无可读文本，跳过索引")

        if self._maybe_cancel(job, reason="处理中被取消"):
            return

        upsert_job_status(job.thread_id, job.filename, {"status": "completed"})
        append_job_event(job.thread_id, job.filename, "处理完成")


_upload_processor: UploadProcessor | None = None


def get_upload_processor() -> UploadProcessor:
    global _upload_processor
    if _upload_processor is None:
        _upload_processor = UploadProcessor()
    return _upload_processor

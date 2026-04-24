"""Middleware to inject uploaded files information into agent context."""

import os
import re
from pathlib import Path
from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import HumanMessage
from langgraph.runtime import Runtime

from src.agents.middlewares.thread_data_middleware import THREAD_DATA_BASE_DIR
from src.config import get_app_config
from src.models.relay_http import relay_requires_sdk_header_strip

_INLINE_PREVIEW_EXTENSIONS = {
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".csv",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".py",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".go",
    ".rs",
    ".sql",
    ".xml",
}
_MAX_INLINE_FILE_CHARS = 6000
_MAX_INLINE_TOTAL_CHARS = 16000


class UploadsMiddlewareState(AgentState):
    """State schema for uploads middleware."""

    uploaded_files: NotRequired[list[dict] | None]


class UploadsMiddleware(AgentMiddleware[UploadsMiddlewareState]):
    """Middleware to inject uploaded files information into the agent context.

    This middleware lists all files in the thread's uploads directory and
    adds a system message with the file list before the agent processes the request.
    """

    state_schema = UploadsMiddlewareState

    def __init__(self, base_dir: str | None = None):
        """Initialize the middleware.

        Args:
            base_dir: Base directory for thread data. Defaults to the current working directory.
        """
        super().__init__()
        self._base_dir = base_dir or os.getcwd()

    def _get_uploads_dir(self, thread_id: str) -> Path:
        """Get the uploads directory for a thread.

        Args:
            thread_id: The thread ID.

        Returns:
            Path to the uploads directory.
        """
        return Path(self._base_dir) / THREAD_DATA_BASE_DIR / thread_id / "user-data" / "uploads"

    def _list_newly_uploaded_files(self, thread_id: str, last_message_files: set[str]) -> list[dict]:
        """List only newly uploaded files that weren't in the last message.

        Args:
            thread_id: The thread ID.
            last_message_files: Set of filenames that were already shown in previous messages.

        Returns:
            List of new file information dictionaries.
        """
        uploads_dir = self._get_uploads_dir(thread_id)

        if not uploads_dir.exists():
            return []

        files = []
        for file_path in sorted(uploads_dir.iterdir()):
            if file_path.is_file() and file_path.name not in last_message_files:
                if file_path.name.startswith("."):
                    continue
                stat = file_path.stat()
                files.append(
                    {
                        "filename": file_path.name,
                        "size": stat.st_size,
                        "path": f"/mnt/user-data/uploads/{file_path.name}",
                        "extension": file_path.suffix,
                    }
                )

        return files

    def _create_files_message(self, files: list[dict]) -> str:
        """Create a formatted message listing uploaded files.

        Args:
            files: List of file information dictionaries.

        Returns:
            Formatted string listing the files.
        """
        if not files:
            return "<uploaded_files>\nNo files have been uploaded yet.\n</uploaded_files>"

        lines = ["<uploaded_files>", "The following files have been uploaded and are available for use:", ""]

        for file in files:
            size_kb = file["size"] / 1024
            if size_kb < 1024:
                size_str = f"{size_kb:.1f} KB"
            else:
                size_str = f"{size_kb / 1024:.1f} MB"

            lines.append(f"- {file['filename']} ({size_str})")
            lines.append(f"  Path: {file['path']}")
            lines.append("")

        lines.append("You can read these files using the `read_file` tool with the paths shown above.")
        lines.append("</uploaded_files>")

        return "\n".join(lines)

    def _should_inline_upload_preview(self, runtime: Runtime) -> bool:
        model_name = runtime.context.get("model_name")
        app_config = get_app_config()
        if model_name is None and app_config.models:
            model_name = app_config.models[0].name

        model_config = app_config.get_model_config(model_name) if model_name else None
        base_url = model_config.model_extra.get("base_url") if model_config else None
        return relay_requires_sdk_header_strip(str(base_url) if base_url else None)

    def _read_preview_text(self, file_path: Path) -> str:
        preferred_path = file_path
        if file_path.suffix.lower() not in _INLINE_PREVIEW_EXTENSIONS:
            markdown_variant = file_path.with_suffix(".md")
            if markdown_variant.exists():
                preferred_path = markdown_variant
            else:
                return ""

        try:
            content = preferred_path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            return ""

        return content[:_MAX_INLINE_FILE_CHARS].strip()

    def _create_inline_preview_message(self, thread_id: str, files: list[dict]) -> str:
        uploads_dir = self._get_uploads_dir(thread_id)
        sections = ["<uploaded_file_previews>", "Relay compatibility mode has inlined file previews below:", ""]
        total_chars = 0

        for file in files:
            if total_chars >= _MAX_INLINE_TOTAL_CHARS:
                break

            file_path = uploads_dir / file["filename"]
            preview = self._read_preview_text(file_path)
            if not preview:
                continue

            remaining = _MAX_INLINE_TOTAL_CHARS - total_chars
            clipped_preview = preview[:remaining].strip()
            if not clipped_preview:
                continue

            sections.append(f"<file name=\"{file['filename']}\">")
            sections.append(clipped_preview)
            sections.append("</file>")
            sections.append("")
            total_chars += len(clipped_preview)

        if total_chars == 0:
            return ""

        sections.append("</uploaded_file_previews>")
        return "\n".join(sections)

    def _extract_files_from_message(self, content: str) -> set[str]:
        """Extract filenames from uploaded_files tag in message content.

        Args:
            content: Message content that may contain <uploaded_files> tag.

        Returns:
            Set of filenames mentioned in the tag.
        """
        # Match <uploaded_files>...</uploaded_files> tag
        match = re.search(r"<uploaded_files>([\s\S]*?)</uploaded_files>", content)
        if not match:
            return set()

        files_content = match.group(1)

        # Extract filenames from lines like "- filename.ext (size)"
        # Need to capture everything before the opening parenthesis, including spaces
        filenames = set()
        for line in files_content.split("\n"):
            # Match pattern: - filename with spaces.ext (size)
            # Changed from [^\s(]+ to [^(]+ to allow spaces in filename
            file_match = re.match(r"^-\s+(.+?)\s*\(", line.strip())
            if file_match:
                filenames.add(file_match.group(1).strip())

        return filenames

    @override
    def before_agent(self, state: UploadsMiddlewareState, runtime: Runtime) -> dict | None:
        """Inject uploaded files information before agent execution.

        Only injects files that weren't already shown in previous messages.
        Prepends file info to the last human message content.

        Args:
            state: Current agent state.
            runtime: Runtime context containing thread_id.

        Returns:
            State updates including uploaded files list.
        """
        import logging

        logger = logging.getLogger(__name__)

        thread_id = runtime.context.get("thread_id")
        if thread_id is None:
            return None

        messages = list(state.get("messages", []))
        if not messages:
            return None

        # Track all filenames that have been shown in previous messages (EXCEPT the last one)
        shown_files: set[str] = set()
        for msg in messages[:-1]:  # Scan all messages except the last one
            if isinstance(msg, HumanMessage):
                content = msg.content if isinstance(msg.content, str) else ""
                extracted = self._extract_files_from_message(content)
                shown_files.update(extracted)
                if extracted:
                    logger.info(f"Found previously shown files: {extracted}")

        logger.info(f"Total shown files from history: {shown_files}")

        # List only newly uploaded files
        files = self._list_newly_uploaded_files(thread_id, shown_files)
        logger.info(f"Newly uploaded files to inject: {[f['filename'] for f in files]}")

        if not files:
            return None

        # Find the last human message and prepend file info to it
        last_message_index = len(messages) - 1
        last_message = messages[last_message_index]

        if not isinstance(last_message, HumanMessage):
            return None

        # Create files message and prepend to the last human message content
        files_message = self._create_files_message(files)
        preview_message = ""
        if self._should_inline_upload_preview(runtime):
            preview_message = self._create_inline_preview_message(thread_id, files)

        # Extract original content - handle both string and list formats
        original_content = ""
        if isinstance(last_message.content, str):
            original_content = last_message.content
        elif isinstance(last_message.content, list):
            # Content is a list of content blocks (e.g., [{"type": "text", "text": "..."}])
            text_parts = []
            for block in last_message.content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
            original_content = "\n".join(text_parts)

        logger.info(f"Original message content: {original_content[:100] if original_content else '(empty)'}")

        # Create new message with combined content
        combined_parts = [files_message]
        if preview_message:
            combined_parts.append(preview_message)
        combined_parts.append(original_content)
        updated_message = HumanMessage(
            content="\n\n".join(part for part in combined_parts if part),
            id=last_message.id,
            additional_kwargs=last_message.additional_kwargs,
        )

        # Replace the last message
        messages[last_message_index] = updated_message

        return {
            "uploaded_files": files,
            "messages": messages,
        }

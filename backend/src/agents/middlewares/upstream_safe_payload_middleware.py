import base64
import copy
import logging
from typing import Any
from urllib.parse import urlparse

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.messages import AnyMessage, SystemMessage

_UPSTREAM_HOSTS_REQUIRING_SAFE_PAYLOAD = ("xxxaicode.com",)
logger = logging.getLogger(__name__)

_SAFE_PAYLOAD_PROMPT = """
Transport note:
- Some message fields in this request may be wrapped as `<safe_payload encoding="utf-8+base64">...</safe_payload>`.
- When present, decode the base64 payload as UTF-8 and treat the decoded text as the true original content.
- This transport encoding is only for compatibility with the upstream relay. Follow the decoded content exactly.
- This rule also applies to prior tool results, prior assistant messages, file names, file paths, and tool call arguments.
""".strip()


class UpstreamSafePayloadMiddleware(AgentMiddleware[AgentState]):
    """Encode non-ASCII request payloads before sending them to unstable relays."""

    state_schema = AgentState

    def _model_base_url(self, request: ModelRequest) -> str | None:
        return getattr(request.model, "openai_api_base", None) or getattr(request.model, "base_url", None)

    def _should_wrap(self, request: ModelRequest) -> bool:
        base_url = self._model_base_url(request)
        if not base_url:
            return False
        hostname = urlparse(str(base_url)).hostname or ""
        return any(
            hostname == blocked_host or hostname.endswith(f".{blocked_host}")
            for blocked_host in _UPSTREAM_HOSTS_REQUIRING_SAFE_PAYLOAD
        )

    def _needs_encoding(self, value: str) -> bool:
        return any(ord(char) > 127 for char in value)

    def _encode_text(self, value: str) -> str:
        payload = base64.b64encode(value.encode("utf-8")).decode("ascii")
        return f'<safe_payload encoding="utf-8+base64">{payload}</safe_payload>'

    def _sanitize_value(self, value: Any) -> tuple[Any, bool]:
        changed = False

        if isinstance(value, str):
            if self._needs_encoding(value):
                return self._encode_text(value), True
            return value, False

        if isinstance(value, list):
            sanitized_items = []
            for item in value:
                sanitized_item, item_changed = self._sanitize_value(item)
                sanitized_items.append(sanitized_item)
                changed = changed or item_changed
            return sanitized_items, changed

        if isinstance(value, dict):
            sanitized_dict: dict[str, Any] = {}
            for key, item in value.items():
                sanitized_item, item_changed = self._sanitize_value(item)
                sanitized_dict[key] = sanitized_item
                changed = changed or item_changed
            return sanitized_dict, changed

        return value, False

    def _sanitize_message(self, message: AnyMessage) -> tuple[AnyMessage, bool]:
        cloned = copy.deepcopy(message)
        changed = False

        sanitized_content, content_changed = self._sanitize_value(cloned.content)
        if content_changed:
            cloned.content = sanitized_content
            changed = True

        if hasattr(cloned, "tool_calls"):
            sanitized_tool_calls, tool_calls_changed = self._sanitize_value(getattr(cloned, "tool_calls"))
            if tool_calls_changed:
                cloned.tool_calls = sanitized_tool_calls
                changed = True

        if hasattr(cloned, "invalid_tool_calls"):
            sanitized_invalid_tool_calls, invalid_changed = self._sanitize_value(
                getattr(cloned, "invalid_tool_calls")
            )
            if invalid_changed:
                cloned.invalid_tool_calls = sanitized_invalid_tool_calls
                changed = True

        sanitized_kwargs, kwargs_changed = self._sanitize_value(cloned.additional_kwargs)
        if kwargs_changed:
            cloned.additional_kwargs = sanitized_kwargs
            changed = True

        return cloned, changed

    def _augment_system_message(self, system_message: SystemMessage | None) -> SystemMessage:
        if system_message is None:
            return SystemMessage(content=_SAFE_PAYLOAD_PROMPT)

        original_text = system_message.text or ""
        if _SAFE_PAYLOAD_PROMPT in original_text:
            return system_message

        cloned = copy.deepcopy(system_message)
        cloned.content = f"{original_text}\n\n{_SAFE_PAYLOAD_PROMPT}".strip()
        return cloned

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler,
    ) -> ModelResponse:
        if not self._should_wrap(request):
            return await handler(request)

        sanitized_messages: list[AnyMessage] = []
        any_changed = False
        for message in request.messages:
            sanitized_message, changed = self._sanitize_message(message)
            sanitized_messages.append(sanitized_message)
            any_changed = any_changed or changed

        sanitized_system_message = request.system_message
        if sanitized_system_message is not None:
            sanitized_system_message, system_changed = self._sanitize_message(sanitized_system_message)
            sanitized_system_message = sanitized_system_message  # type: ignore[assignment]
            any_changed = any_changed or system_changed

        if any_changed:
            sanitized_system_message = self._augment_system_message(sanitized_system_message)
            preview = ""
            if sanitized_messages:
                preview = str(sanitized_messages[0].content)[:160]
            logger.info("Safe payload middleware encoded request content for upstream relay. preview=%s", preview)
            request = request.override(
                messages=sanitized_messages,
                system_message=sanitized_system_message,
            )
        else:
            logger.info("Safe payload middleware found no non-ASCII content to encode for this request.")

        return await handler(request)

import json
import logging
import time
from collections.abc import Sequence
from functools import cached_property
from typing import Any

import httpx
from langchain_core.language_models.chat_models import SimpleChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import Runnable
from pydantic import ConfigDict, Field, SecretStr

from src.models.relay_http import get_relay_compatible_http_clients

_TOOL_LIMITATION_NOTE = """
Compatibility mode is enabled for this upstream relay.
- External tool calling is unavailable in this request.
- Answer directly from the conversation context and any uploaded file previews already included in the messages.
- If important information is missing, ask one focused clarification question instead of pretending to use tools.
""".strip()

_TIMEOUT_REDUCTION_NOTE = """
Relay timeout mitigation mode is enabled.
- Focus on the latest user request and the latest uploaded file preview already present in context.
- Ignore stale intermediate tool traces and long historical detail unless the latest user request explicitly depends on them.
- Keep the answer concise and practical unless the user explicitly asks for a very long output.
""".strip()

_MAX_INITIAL_MESSAGES = 14
_MAX_INITIAL_CHARS = 12_000
_COMPACT_KEEP_NON_SYSTEM = 8
_COMPACT_TOTAL_CHARS = 12_000
_COMPACT_MESSAGE_CHARS = 2_200
_COMPACT_LAST_HUMAN_CHARS = 5_000
_COMPACT_RETRY_STATUS_CODES = {404, 413, 414, 422, 504, 524}

logger = logging.getLogger(__name__)


class RelayCompatibleChatModel(SimpleChatModel):
    """Minimal OpenAI-compatible chat model for relays that reject SDK fingerprints."""

    model_name: str = Field(alias="model")
    api_key: SecretStr | str | None = Field(default=None, alias="api_key")
    base_url: str = Field(alias="base_url")
    request_timeout: float | None = Field(default=None, alias="timeout")
    max_tokens: int | None = None
    temperature: float | None = None
    top_p: float | None = None
    presence_penalty: float | None = None
    frequency_penalty: float | None = None
    seed: int | None = None
    use_responses_api: bool | None = None
    bound_tools: list[Any] = Field(default_factory=list, exclude=True)

    model_config = ConfigDict(populate_by_name=True, extra="allow")

    @property
    def _llm_type(self) -> str:
        return "relay_compatible_chat"

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {
            "model_name": self.model_name,
            "base_url": self.base_url,
            "use_responses_api": self.use_responses_api,
        }

    @property
    def openai_api_base(self) -> str:
        return self.base_url

    @cached_property
    def _http_client(self):
        client, _ = get_relay_compatible_http_clients(
            base_url=self.base_url,
            timeout=self.request_timeout,
        )
        return client

    def bind_tools(
        self,
        tools: Sequence[dict[str, Any] | type | Any],
        *,
        tool_choice: str | None = None,
        **kwargs: Any,
    ) -> Runnable:
        del tool_choice, kwargs
        cloned = self.model_copy(deep=True)
        cloned.bound_tools = list(tools)
        return cloned

    def _api_key_value(self) -> str | None:
        if isinstance(self.api_key, SecretStr):
            return self.api_key.get_secret_value()
        return self.api_key

    def _content_to_text(self, content: Any) -> str:
        if isinstance(content, str):
            return content

        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                    continue

                if not isinstance(block, dict):
                    parts.append(str(block))
                    continue

                block_type = block.get("type")
                if block_type in {"text", "input_text", "output_text"}:
                    parts.append(str(block.get("text", "")))
                elif "text" in block:
                    parts.append(str(block["text"]))
                else:
                    parts.append(f"[{block_type or 'content'} omitted]")
            return "\n".join(part for part in parts if part).strip()

        return str(content)

    def _message_to_payload(self, message: BaseMessage) -> dict[str, str] | None:
        if isinstance(message, SystemMessage):
            role = "system"
            content = self._content_to_text(message.content)
        elif isinstance(message, HumanMessage):
            role = "user"
            content = self._content_to_text(message.content)
        elif isinstance(message, AIMessage):
            role = "assistant"
            content = self._content_to_text(message.content)
        elif isinstance(message, ToolMessage):
            role = "user"
            tool_name = getattr(message, "name", None) or getattr(message, "tool_call_id", None) or "tool"
            content = f"[Tool output: {tool_name}]\n{self._content_to_text(message.content)}"
        else:
            role = "user"
            content = f"[{message.__class__.__name__}]\n{self._content_to_text(message.content)}"

        content = content.strip()
        if not content:
            return None
        return {"role": role, "content": content}

    def _clip_text(self, text: str, limit: int) -> str:
        if len(text) <= limit:
            return text
        return f"{text[: limit - 40].rstrip()}\n\n[truncated for relay compatibility]"

    def _add_or_extend_system_message(self, payload_messages: list[dict[str, str]], note: str) -> None:
        first_system_index = next(
            (idx for idx, message in enumerate(payload_messages) if message["role"] == "system"),
            None,
        )
        if first_system_index is not None:
            payload_messages[first_system_index]["content"] = (
                f"{payload_messages[first_system_index]['content']}\n\n{note}"
            )
        else:
            payload_messages.insert(0, {"role": "system", "content": note})

    def _build_payload_messages(self, messages: list[BaseMessage]) -> list[dict[str, str]]:
        payload_messages: list[dict[str, str]] = []

        for message in messages:
            serialized = self._message_to_payload(message)
            if serialized is None:
                continue
            payload_messages.append(serialized)

        if self.bound_tools:
            self._add_or_extend_system_message(payload_messages, _TOOL_LIMITATION_NOTE)

        return payload_messages

    def _payload_char_count(self, payload_messages: list[dict[str, str]]) -> int:
        return sum(len(message.get("content", "")) for message in payload_messages)

    def _should_use_compact_mode(self, payload_messages: list[dict[str, str]]) -> bool:
        return (
            len(payload_messages) > _MAX_INITIAL_MESSAGES
            or self._payload_char_count(payload_messages) > _MAX_INITIAL_CHARS
        )

    def _build_compact_payload_messages(self, messages: list[BaseMessage]) -> list[dict[str, str]]:
        serialized_messages = [payload for message in messages if (payload := self._message_to_payload(message)) is not None]
        system_messages = [message.copy() for message in serialized_messages if message["role"] == "system"]
        non_system_messages = [message.copy() for message in serialized_messages if message["role"] != "system"]

        compact_non_system = non_system_messages[-_COMPACT_KEEP_NON_SYSTEM :]
        clipped_messages: list[dict[str, str]] = []

        last_user_index = max(
            (idx for idx, message in enumerate(compact_non_system) if message["role"] == "user"),
            default=-1,
        )

        for idx, message in enumerate(compact_non_system):
            clip_limit = _COMPACT_LAST_HUMAN_CHARS if idx == last_user_index else _COMPACT_MESSAGE_CHARS
            clipped_messages.append(
                {
                    "role": message["role"],
                    "content": self._clip_text(message["content"], clip_limit),
                }
            )

        compact_messages: list[dict[str, str]] = []
        for message in system_messages:
            compact_messages.append(
                {
                    "role": "system",
                    "content": self._clip_text(message["content"], _COMPACT_MESSAGE_CHARS),
                }
            )

        compact_messages.extend(clipped_messages)
        self._add_or_extend_system_message(compact_messages, _TIMEOUT_REDUCTION_NOTE)

        while self._payload_char_count(compact_messages) > _COMPACT_TOTAL_CHARS and len(compact_messages) > 1:
            removable_index = next(
                (idx for idx, message in enumerate(compact_messages[1:], start=1) if message["role"] != "system"),
                None,
            )
            if removable_index is None:
                break
            compact_messages.pop(removable_index)

        return compact_messages

    def _build_direct_fallback_payload_messages(self, messages: list[BaseMessage]) -> list[dict[str, str]]:
        serialized_messages = [
            payload
            for message in messages
            if (payload := self._message_to_payload(message)) is not None
        ]
        latest_content = ""
        for message in reversed(serialized_messages):
            if message["role"] == "user":
                latest_content = message["content"]
                break
        if not latest_content and serialized_messages:
            latest_content = serialized_messages[-1]["content"]
        if not latest_content:
            latest_content = "Continue the conversation."

        return [
            {
                "role": "system",
                "content": _TIMEOUT_REDUCTION_NOTE,
            },
            {
                "role": "user",
                "content": self._clip_text(latest_content, _COMPACT_LAST_HUMAN_CHARS),
            },
        ]

    def _request_headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key_value() or ''}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0",
        }

    def _post_chat_completion(
        self,
        payload: dict[str, Any],
        *,
        fresh_client: bool = False,
    ) -> httpx.Response:
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        if fresh_client:
            with httpx.Client(timeout=self.request_timeout) as client:
                return client.post(
                    url,
                    headers=self._request_headers(),
                    json=payload,
                )
        return self._http_client.post(
            url,
            headers=self._request_headers(),
            json=payload,
        )

    def _call(
        self,
        messages: list[BaseMessage],
        stop: list[str] | None = None,
        run_manager=None,
        **kwargs: Any,
    ) -> str:
        del run_manager

        base_messages = self._build_payload_messages(messages)
        compact_mode = self._should_use_compact_mode(base_messages)
        request_messages = self._build_compact_payload_messages(messages) if compact_mode else base_messages

        logger.info(
            "Relay-compatible model request prepared: messages=%s chars=%s compact_mode=%s",
            len(request_messages),
            self._payload_char_count(request_messages),
            compact_mode,
        )

        payload = self._build_payload(
            request_messages=request_messages,
            stop=stop,
            compact_mode=compact_mode,
            **kwargs,
        )

        try:
            response = self._post_chat_completion(payload)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            recovered_with_compact = False
            if (
                exc.response.status_code in _COMPACT_RETRY_STATUS_CODES
                and not compact_mode
            ):
                fallback_messages = self._build_compact_payload_messages(messages)
                logger.warning(
                    "Relay upstream returned %s; retrying once with compact payload: messages=%s chars=%s",
                    exc.response.status_code,
                    len(fallback_messages),
                    self._payload_char_count(fallback_messages),
                )
                payload = self._build_payload(
                    request_messages=fallback_messages,
                    stop=stop,
                    compact_mode=True,
                    **kwargs,
                )
                try:
                    response = self._post_chat_completion(payload)
                    response.raise_for_status()
                    recovered_with_compact = True
                except httpx.HTTPStatusError as compact_exc:
                    if compact_exc.response.status_code not in _COMPACT_RETRY_STATUS_CODES:
                        raise
                    exc = compact_exc

            if (
                not recovered_with_compact
                and exc.response.status_code in _COMPACT_RETRY_STATUS_CODES
            ):
                fallback_messages = self._build_direct_fallback_payload_messages(messages)
                logger.warning(
                    "Relay upstream returned %s; retrying once with direct-answer fallback: messages=%s chars=%s",
                    exc.response.status_code,
                    len(fallback_messages),
                    self._payload_char_count(fallback_messages),
                )
                payload = self._build_payload(
                    request_messages=fallback_messages,
                    stop=stop,
                    compact_mode=True,
                    **kwargs,
                )
                time.sleep(1)
                for attempt in range(2):
                    response = self._post_chat_completion(payload, fresh_client=True)
                    try:
                        response.raise_for_status()
                        break
                    except httpx.HTTPStatusError as fallback_exc:
                        if (
                            attempt == 0
                            and fallback_exc.response.status_code
                            in _COMPACT_RETRY_STATUS_CODES
                        ):
                            logger.warning(
                                "Relay direct-answer fallback returned %s; retrying after backoff",
                                fallback_exc.response.status_code,
                            )
                            time.sleep(2)
                            continue
                        raise
            elif not recovered_with_compact:
                raise

        data = response.json()

        choices = data.get("choices") or []
        if not choices:
            return ""

        message = choices[0].get("message") or {}
        content = message.get("content", "")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return self._content_to_text(content)
        return json.dumps(content, ensure_ascii=False)

    def _build_payload(
        self,
        request_messages: list[dict[str, str]],
        stop: list[str] | None,
        compact_mode: bool,
        **kwargs: Any,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model_name,
            "messages": request_messages,
        }

        max_completion_tokens = kwargs.get("max_completion_tokens") or kwargs.get("max_tokens") or self.max_tokens
        if compact_mode and max_completion_tokens is None:
            max_completion_tokens = 700

        if max_completion_tokens is not None:
            payload["max_completion_tokens"] = max_completion_tokens
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        if self.top_p is not None:
            payload["top_p"] = self.top_p
        if self.presence_penalty is not None:
            payload["presence_penalty"] = self.presence_penalty
        if self.frequency_penalty is not None:
            payload["frequency_penalty"] = self.frequency_penalty
        if self.seed is not None:
            payload["seed"] = self.seed
        if stop:
            payload["stop"] = stop

        return payload

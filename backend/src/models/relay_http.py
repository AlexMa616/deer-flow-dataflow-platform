import logging
from typing import Any
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

_SDK_FINGERPRINTED_HOSTS = ("xxxaicode.com",)
_relay_http_clients: dict[tuple[str, str], tuple[httpx.Client, httpx.AsyncClient]] = {}


def relay_requires_sdk_header_strip(base_url: str | None) -> bool:
    if not base_url:
        return False

    hostname = urlparse(str(base_url)).hostname or ""
    return any(
        hostname == blocked_host or hostname.endswith(f".{blocked_host}")
        for blocked_host in _SDK_FINGERPRINTED_HOSTS
    )


def _strip_sdk_headers(request: httpx.Request) -> None:
    for key in list(request.headers.keys()):
        if key.lower().startswith("x-stainless-"):
            request.headers.pop(key, None)

    request.headers["User-Agent"] = "Mozilla/5.0"
    request.headers["Accept"] = "application/json"


async def _strip_sdk_headers_async(request: httpx.Request) -> None:
    _strip_sdk_headers(request)


def _timeout_cache_key(timeout: Any) -> str:
    if timeout is None:
        return "none"
    return repr(timeout)


def get_relay_compatible_http_clients(
    base_url: str,
    timeout: Any = None,
) -> tuple[httpx.Client, httpx.AsyncClient]:
    cache_key = (base_url, _timeout_cache_key(timeout))
    cached = _relay_http_clients.get(cache_key)
    if cached is not None:
        return cached

    sync_client = httpx.Client(
        timeout=timeout,
        event_hooks={"request": [_strip_sdk_headers]},
    )
    async_client = httpx.AsyncClient(
        timeout=timeout,
        event_hooks={"request": [_strip_sdk_headers_async]},
    )
    _relay_http_clients[cache_key] = (sync_client, async_client)
    logger.info("Created relay-compatible HTTP clients for upstream base_url=%s", base_url)
    return sync_client, async_client

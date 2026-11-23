"""agentos.http — gateway URL helpers + JSON fetch for SDK clients."""

from __future__ import annotations

import os
from typing import Any, Mapping, Optional

import httpx

DEFAULT_GATEWAY = "http://127.0.0.1:5173"

EnvMap = Mapping[str, Optional[str]]


def resolve_gateway_url(env: EnvMap | None = None) -> str:
    """Resolve Shell gateway origin (`AGENT_OS_GLOBAL_GATEWAY_URL` or local Vite default)."""
    source = env if env is not None else os.environ
    raw = source.get("AGENT_OS_GLOBAL_GATEWAY_URL") or DEFAULT_GATEWAY
    return raw.rstrip("/")


def resolve_ext_api_base(
    ext_id: str,
    override_env_key: str,
    env: EnvMap | None = None,
) -> str:
    """Resolve builtin/extension API base: override env or `{gateway}/api/ext/{ext_id}`."""
    source = env if env is not None else os.environ
    override = source.get(override_env_key)
    if override:
        return override.rstrip("/")
    return f"{resolve_gateway_url(source)}/api/ext/{ext_id}"


async def json_fetch(
    url: str,
    *,
    method: str | None = None,
    body: Any = None,
    headers: dict[str, str] | None = None,
    allow_empty: bool = False,
    label: str = "request",
    client: httpx.AsyncClient | None = None,
) -> Any:
    """`httpx` + JSON parse; raises on non-OK with status + body text."""
    req_headers = dict(headers or {})
    http_method = (method or ("POST" if body is not None else "GET")).upper()
    content: Any = None
    if body is not None:
        if "content-type" not in {k.lower() for k in req_headers}:
            req_headers["content-type"] = "application/json"
        content = body

    async def _do(c: httpx.AsyncClient) -> httpx.Response:
        return await c.request(
            http_method,
            url,
            headers=req_headers,
            json=content if content is not None else None,
        )

    if client is not None:
        res = await _do(client)
    else:
        async with httpx.AsyncClient() as owned:
            res = await _do(owned)

    if not res.is_success:
        detail = res.text
        raise RuntimeError(
            f"{label} failed ({res.status_code}): {detail or res.reason_phrase}",
        )

    if allow_empty and res.status_code == 204:
        return None

    text = res.text
    if not text:
        if allow_empty:
            return None
        raise RuntimeError(f"{label} failed: empty response body")
    return res.json()


async def post_json(
    url: str,
    body: Any,
    label: str,
    *,
    client: httpx.AsyncClient | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    """POST JSON helper used by domain clients."""
    return await json_fetch(
        url,
        method="POST",
        body=body if body is not None else {},
        headers=headers,
        label=label,
        client=client,
    )


async def get_json(
    url: str,
    label: str,
    *,
    client: httpx.AsyncClient | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    """GET JSON helper used by domain clients."""
    return await json_fetch(
        url,
        method="GET",
        headers=headers,
        label=label,
        client=client,
    )


async def put_json(
    url: str,
    body: Any,
    label: str,
    *,
    client: httpx.AsyncClient | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    """PUT JSON helper used by domain clients."""
    return await json_fetch(
        url,
        method="PUT",
        body=body if body is not None else {},
        headers=headers,
        label=label,
        client=client,
    )


async def delete_json(
    url: str,
    label: str,
    *,
    client: httpx.AsyncClient | None = None,
    headers: dict[str, str] | None = None,
    body: Any = None,
    allow_empty: bool = False,
) -> Any:
    """DELETE JSON helper used by domain clients."""
    return await json_fetch(
        url,
        method="DELETE",
        body=body,
        headers=headers,
        label=label,
        client=client,
        allow_empty=allow_empty,
    )

"""agentos.files — HTTP client for builtin `files` (ticket 82)."""

from __future__ import annotations

import base64
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel

from agentos.http import (
    EnvMap,
    delete_json,
    get_json,
    put_json,
    resolve_ext_api_base,
)


def resolve_files_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin files API base (`…/api/ext/files` or test override)."""
    return resolve_ext_api_base("files", "AGENT_OS_FILES_API_BASE", env)


class PutBlobResult(BaseModel):
    ok: bool
    key: str
    bytes: int


class GetBlobBase64Result(BaseModel):
    key: str
    base64: str
    bytes: int


def _blob_url(base: str, key: str) -> str:
    return f"{base}/blobs/{quote(key, safe='')}"


async def put_blob(
    key: str,
    data: bytes | str,
    env: EnvMap | None = None,
    *,
    client: httpx.AsyncClient | None = None,
) -> PutBlobResult:
    """Put raw bytes (octet-stream) or base64 string (JSON body)."""
    base = resolve_files_api_base(env)
    url = _blob_url(base, key)

    if isinstance(data, str):
        payload = await put_json(
            url,
            {"base64": data},
            "files putBlob",
            client=client,
        )
        return PutBlobResult.model_validate(payload)

    headers = {"content-type": "application/octet-stream"}

    async def _do(c: httpx.AsyncClient) -> httpx.Response:
        return await c.request("PUT", url, headers=headers, content=data)

    if client is not None:
        res = await _do(client)
    else:
        async with httpx.AsyncClient() as owned:
            res = await _do(owned)

    if not res.is_success:
        detail = res.text
        raise RuntimeError(
            f"files putBlob failed ({res.status_code}): {detail or res.reason_phrase}",
        )
    return PutBlobResult.model_validate(res.json())


async def get_blob(
    key: str,
    env: EnvMap | None = None,
    *,
    client: httpx.AsyncClient | None = None,
) -> bytes:
    """Get blob as raw bytes."""
    base = resolve_files_api_base(env)
    url = _blob_url(base, key)

    async def _do(c: httpx.AsyncClient) -> httpx.Response:
        return await c.get(url)

    if client is not None:
        res = await _do(client)
    else:
        async with httpx.AsyncClient() as owned:
            res = await _do(owned)

    if not res.is_success:
        detail = res.text
        raise RuntimeError(
            f"files getBlob failed ({res.status_code}): {detail or res.reason_phrase}",
        )
    return res.content


async def get_blob_base64(
    key: str,
    env: EnvMap | None = None,
    *,
    client: httpx.AsyncClient | None = None,
) -> GetBlobBase64Result:
    """Get blob as base64 JSON (`?format=json`)."""
    base = resolve_files_api_base(env)
    data = await get_json(
        f"{_blob_url(base, key)}?format=json",
        "files getBlobBase64",
        client=client,
    )
    return GetBlobBase64Result.model_validate(data)


class DeleteBlobResult(BaseModel):
    ok: bool
    key: str


async def delete_blob(
    key: str,
    env: EnvMap | None = None,
    *,
    client: httpx.AsyncClient | None = None,
) -> DeleteBlobResult:
    """Delete a blob by key (idempotent when missing)."""
    base = resolve_files_api_base(env)
    data = await delete_json(
        _blob_url(base, key),
        "files deleteBlob",
        client=client,
    )
    return DeleteBlobResult.model_validate(data)


def encode_bytes(data: bytes) -> str:
    """Encode bytes as standard base64 (for `put_blob` string path)."""
    return base64.b64encode(data).decode("ascii")


def decode_base64(value: str) -> bytes:
    """Decode standard base64 from `get_blob_base64`."""
    return base64.b64decode(value)

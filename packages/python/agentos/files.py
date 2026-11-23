"""agentos.files — HTTP client for builtin `files` (tickets 82, 96)."""

from __future__ import annotations

import base64
from typing import Any
from urllib.parse import quote, urlencode

import httpx
from pydantic import BaseModel, Field

from agentos.http import (
    EnvMap,
    delete_json,
    get_json,
    json_fetch,
    put_json,
    resolve_ext_api_base,
)

FILES_ORG_ID_HEADER = "x-agentos-org-id"


def resolve_files_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin files API base (`…/api/ext/files` or test override)."""
    return resolve_ext_api_base("files", "AGENT_OS_FILES_API_BASE", env)


class PutBlobResult(BaseModel):
    ok: bool
    key: str
    bytes: int
    contentType: str | None = None


class GetBlobBase64Result(BaseModel):
    key: str
    base64: str
    bytes: int
    contentType: str | None = None
    updatedAt: str | None = None


class DeleteBlobResult(BaseModel):
    ok: bool
    key: str


class FilesListItem(BaseModel):
    key: str
    name: str
    kind: str
    bytes: int | None = None
    contentType: str | None = None
    updatedAt: str | None = None
    relativeKey: str


class ListBlobsResult(BaseModel):
    items: list[FilesListItem]
    cursor: str | None = None
    prefix: str = ""
    q: str | None = None


class MoveBlobResult(BaseModel):
    ok: bool
    from_key: str | None = Field(default=None, alias="from")
    to: str | None = None
    moved: list[str] | None = None

    model_config = {"populate_by_name": True}


def _blob_url(base: str, key: str) -> str:
    return f"{base}/blobs/{quote(key, safe='')}"


def _org_headers(org_id: str | None) -> dict[str, str]:
    if not org_id:
        return {}
    return {FILES_ORG_ID_HEADER: org_id}


async def put_blob(
    key: str,
    data: bytes | str,
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
    content_type: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> PutBlobResult:
    """Put raw bytes (octet-stream) or base64 string (JSON body)."""
    base = resolve_files_api_base(env)
    url = _blob_url(base, key)
    headers = _org_headers(org_id)

    if isinstance(data, str):
        body: dict[str, str] = {"base64": data}
        if content_type:
            body["contentType"] = content_type
        payload = await put_json(
            url,
            body,
            "files putBlob",
            client=client,
            headers=headers or None,
        )
        return PutBlobResult.model_validate(payload)

    headers = {
        **headers,
        "content-type": content_type or "application/octet-stream",
    }
    if content_type:
        headers["x-agentos-content-type"] = content_type

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
    org_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> bytes:
    """Get blob as raw bytes."""
    base = resolve_files_api_base(env)
    url = _blob_url(base, key)
    headers = _org_headers(org_id)

    async def _do(c: httpx.AsyncClient) -> httpx.Response:
        return await c.get(url, headers=headers or None)

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
    org_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> GetBlobBase64Result:
    """Get blob as base64 JSON (`?format=json`)."""
    base = resolve_files_api_base(env)
    data = await get_json(
        f"{_blob_url(base, key)}?format=json",
        "files getBlobBase64",
        client=client,
        headers=_org_headers(org_id) or None,
    )
    return GetBlobBase64Result.model_validate(data)


async def delete_blob(
    key: str,
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> DeleteBlobResult:
    """Delete a blob by key (idempotent when missing)."""
    base = resolve_files_api_base(env)
    data = await delete_json(
        _blob_url(base, key),
        "files deleteBlob",
        client=client,
        headers=_org_headers(org_id) or None,
    )
    return DeleteBlobResult.model_validate(data)


async def list_blobs(
    *,
    prefix: str = "",
    limit: int | None = None,
    cursor: str | None = None,
    q: str | None = None,
    env: EnvMap | None = None,
    org_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> ListBlobsResult:
    """List blobs / virtual folders under a prefix (org-scoped)."""
    base = resolve_files_api_base(env)
    params: dict[str, Any] = {}
    if prefix:
        params["prefix"] = prefix
    if limit is not None:
        params["limit"] = limit
    if cursor:
        params["cursor"] = cursor
    if q:
        params["q"] = q
    qs = urlencode(params)
    url = f"{base}/blobs" + (f"?{qs}" if qs else "")
    data = await get_json(
        url,
        "files listBlobs",
        client=client,
        headers=_org_headers(org_id) or None,
    )
    return ListBlobsResult.model_validate(data)


async def move_blob(
    from_key: str,
    to_key: str,
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> MoveBlobResult:
    """Move/rename a file or folder prefix."""
    base = resolve_files_api_base(env)
    data = await json_fetch(
        f"{base}/blobs/move",
        method="POST",
        body={"from": from_key, "to": to_key},
        headers=_org_headers(org_id) or None,
        label="files moveBlob",
        client=client,
    )
    return MoveBlobResult.model_validate(data)


def encode_bytes(data: bytes) -> str:
    """Encode bytes as standard base64 (for `put_blob` string path)."""
    return base64.b64encode(data).decode("ascii")


def decode_base64(value: str) -> bytes:
    """Decode standard base64 from `get_blob_base64`."""
    return base64.b64decode(value)

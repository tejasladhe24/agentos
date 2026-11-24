"""agentos.files — HTTP client for builtin `files` (tickets 82, 96, 110).

Keys may be legacy org keys (`docs/a.txt`, `orgs/<orgId>/docs/a.txt` → platform
mount) or canonical references `files://<mountId>/<path>`.
"""

from __future__ import annotations

import base64
import re
from typing import Any, Literal
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

FILES_REF_SCHEME = "files://"
PLATFORM_MOUNT_ID = "platform"
DEFAULT_MOUNT_ALIAS = "default"

_MOUNT_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
_LEGACY_KEY_RE = re.compile(r"^orgs/([^/]+)/(.*)$")


class FileRef(BaseModel):
    mountId: str
    path: str


def is_file_ref(value: object) -> bool:
    return isinstance(value, str) and value.startswith(FILES_REF_SCHEME)


def format_file_ref(mount_id: str, path: str) -> str:
    return f"{FILES_REF_SCHEME}{mount_id}/{path.lstrip('/')}"


def parse_file_ref(value: str) -> FileRef | None:
    """Parse `files://<mountId>/<path>`; `None` when not a valid reference."""
    if not is_file_ref(value):
        return None
    rest = value[len(FILES_REF_SCHEME) :]
    mount_id, _, path = rest.partition("/")
    if not _MOUNT_ID_RE.match(mount_id):
        return None
    return FileRef(mountId=mount_id, path=path)


def to_file_ref(key_or_ref: str, org_id: str | None = None) -> str:
    """Legacy key or reference → reference (legacy keys → platform mount)."""
    parsed = parse_file_ref(key_or_ref)
    if parsed:
        return format_file_ref(parsed.mountId, parsed.path)
    trimmed = key_or_ref.lstrip("/")
    path = trimmed
    if org_id and trimmed.startswith(f"orgs/{org_id}/"):
        path = trimmed[len(f"orgs/{org_id}/") :]
    elif not org_id:
        match = _LEGACY_KEY_RE.match(trimmed)
        if match:
            path = match.group(2)
    return format_file_ref(PLATFORM_MOUNT_ID, path)


def org_id_from_legacy_key(key: str) -> str | None:
    match = _LEGACY_KEY_RE.match(key.lstrip("/"))
    return match.group(1) if match else None


def resolve_files_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin files API base (`…/api/ext/files` or test override)."""
    return resolve_ext_api_base("files", "AGENT_OS_FILES_API_BASE", env)


class PutBlobResult(BaseModel):
    ok: bool
    key: str
    ref: str | None = None
    mountId: str | None = None
    bytes: int
    contentType: str | None = None


class GetBlobBase64Result(BaseModel):
    key: str
    ref: str | None = None
    mountId: str | None = None
    base64: str
    bytes: int
    contentType: str | None = None
    updatedAt: str | None = None


class DeleteBlobResult(BaseModel):
    ok: bool
    key: str
    ref: str | None = None


class FilesListItem(BaseModel):
    key: str
    name: str
    kind: str
    bytes: int | None = None
    contentType: str | None = None
    updatedAt: str | None = None
    relativeKey: str
    mountId: str | None = None
    ref: str | None = None


class ListBlobsResult(BaseModel):
    items: list[FilesListItem]
    cursor: str | None = None
    prefix: str = ""
    q: str | None = None
    mountId: str | None = None


class MoveBlobResult(BaseModel):
    ok: bool
    from_key: str | None = Field(default=None, alias="from")
    to: str | None = None
    fromRef: str | None = None
    toRef: str | None = None
    moved: list[str] | None = None
    copied: list[str] | None = None
    refs: list[str] | None = None
    total: int | None = None

    model_config = {"populate_by_name": True}


CopyBlobResult = MoveBlobResult


class StorageCapabilities(BaseModel):
    serverSideCopy: bool
    nativeFolders: bool
    nativeTrash: bool
    versions: bool
    maxFileSize: int
    exportFormats: list[str] = Field(default_factory=list)
    quota: bool


class MountUsage(BaseModel):
    files: int
    bytes: int


class FilesMount(BaseModel):
    id: str
    kind: Literal["org", "personal"] = "org"
    ownerUserId: str | None = None
    provider: str
    name: str
    isDefault: bool = False
    status: str = "connected"
    statusMessage: str | None = None
    builtin: bool | None = None
    config: dict[str, Any] | None = None
    capabilities: StorageCapabilities | None = None
    indexMode: str | None = None
    usage: MountUsage | None = None


class StorageProviderInfo(BaseModel):
    id: str
    label: str
    icon: str | None = None
    orgAddable: bool = False
    personal: bool = False


class ListMountsResult(BaseModel):
    mounts: list[FilesMount] = Field(default_factory=list)
    defaultMountId: str = PLATFORM_MOUNT_ID
    providers: list[StorageProviderInfo] = Field(default_factory=list)
    canManage: bool = False


def _blob_url(base: str, key: str, mount_id: str | None = None) -> str:
    url = f"{base}/blobs/{quote(key, safe='')}"
    if mount_id:
        url += f"?mount={quote(mount_id, safe='')}"
    return url


def _with_query(url: str, query: str) -> str:
    return f"{url}{'&' if '?' in url else '?'}{query}"


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
    mount_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> PutBlobResult:
    """Put raw bytes (octet-stream) or base64 string (JSON body).

    `mount_id` targets a mount for plain keys (`default` = org default mount).
    """
    base = resolve_files_api_base(env)
    url = _blob_url(base, key, mount_id)
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
    mount_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> bytes:
    """Get blob as raw bytes."""
    base = resolve_files_api_base(env)
    url = _blob_url(base, key, mount_id)
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
    mount_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> GetBlobBase64Result:
    """Get blob as base64 JSON (`?format=json`)."""
    base = resolve_files_api_base(env)
    data = await get_json(
        _with_query(_blob_url(base, key, mount_id), "format=json"),
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
    mount_id: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> DeleteBlobResult:
    """Delete a blob by key (idempotent when missing)."""
    base = resolve_files_api_base(env)
    data = await delete_json(
        _blob_url(base, key, mount_id),
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
    mount_id: str | None = None,
    view: Literal["files", "bin", "storage"] | None = None,
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
    if mount_id:
        params["mount"] = mount_id
    if view:
        params["view"] = view
    qs = urlencode(params)
    url = f"{base}/blobs" + (f"?{qs}" if qs else "")
    data = await get_json(
        url,
        "files listBlobs",
        client=client,
        headers=_org_headers(org_id) or None,
    )
    return ListBlobsResult.model_validate(data)


def _transfer_body(
    from_key: str,
    to_key: str,
    mount_id: str | None,
    from_mount: str | None,
    to_mount: str | None,
) -> dict[str, str]:
    body = {"from": from_key, "to": to_key}
    if mount_id:
        body["mount"] = mount_id
    if from_mount:
        body["fromMount"] = from_mount
    if to_mount:
        body["toMount"] = to_mount
    return body


async def move_blob(
    from_key: str,
    to_key: str,
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
    mount_id: str | None = None,
    from_mount: str | None = None,
    to_mount: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> MoveBlobResult:
    """Move/rename a file or folder prefix (within or across mounts)."""
    base = resolve_files_api_base(env)
    data = await json_fetch(
        f"{base}/blobs/move",
        method="POST",
        body=_transfer_body(from_key, to_key, mount_id, from_mount, to_mount),
        headers=_org_headers(org_id) or None,
        label="files moveBlob",
        client=client,
    )
    return MoveBlobResult.model_validate(data)


async def copy_blob(
    from_key: str,
    to_key: str,
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
    mount_id: str | None = None,
    from_mount: str | None = None,
    to_mount: str | None = None,
    client: httpx.AsyncClient | None = None,
) -> CopyBlobResult:
    """Copy a file or folder prefix; across mounts this streams bytes."""
    base = resolve_files_api_base(env)
    data = await json_fetch(
        f"{base}/blobs/copy",
        method="POST",
        body=_transfer_body(from_key, to_key, mount_id, from_mount, to_mount),
        headers=_org_headers(org_id) or None,
        label="files copyBlob",
        client=client,
    )
    return CopyBlobResult.model_validate(data)


async def list_mounts(
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
    usage: bool = False,
    client: httpx.AsyncClient | None = None,
) -> ListMountsResult:
    """Mounts visible to the caller (platform first) + default upload mount."""
    base = resolve_files_api_base(env)
    data = await get_json(
        f"{base}/mounts" + ("?usage=1" if usage else ""),
        "files listMounts",
        client=client,
        headers=_org_headers(org_id) or None,
    )
    return ListMountsResult.model_validate(data)


def encode_bytes(data: bytes) -> str:
    """Encode bytes as standard base64 (for `put_blob` string path)."""
    return base64.b64encode(data).decode("ascii")


def decode_base64(value: str) -> bytes:
    """Decode standard base64 from `get_blob_base64`."""
    return base64.b64decode(value)

"""agentos.secrets — HTTP client for builtin `secrets` (ticket 82).

Env fallback + per-org vault. Prefer vault writes with `org_id` /
`X-AgentOS-Org-Id` for tenant credentials.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from pydantic import BaseModel

from agentos.http import (
    EnvMap,
    delete_json,
    get_json,
    put_json,
    resolve_ext_api_base,
)

SECRETS_ORG_ID_HEADER = "x-agentos-org-id"


def resolve_secrets_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin secrets API base (`…/api/ext/secrets` or test override)."""
    return resolve_ext_api_base("secrets", "AGENT_OS_SECRETS_API_BASE", env)


class SecretValue(BaseModel):
    key: str
    value: str
    rotatedAt: str | None = None
    expiresAt: str | None = None
    version: int | None = None
    source: str | None = None


class SecretMeta(BaseModel):
    key: str
    rotatedAt: str
    version: int
    expiresAt: str | None = None


class DeleteSecretResult(BaseModel):
    key: str
    deleted: bool


class SecretListItem(BaseModel):
    key: str
    updatedAt: str | None = None
    expiresAt: str | None = None
    hasValue: bool = True
    managed: bool | None = None


class SecretListResult(BaseModel):
    orgId: str
    canWrite: bool
    keys: list[SecretListItem]


def _headers(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, str] | None:
    merged = dict(headers or {})
    if org_id:
        merged[SECRETS_ORG_ID_HEADER] = org_id
    return merged or None


async def list_secrets(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> SecretListResult:
    """List vault secret metadata for the active org (no plaintext values)."""
    base = resolve_secrets_api_base(env)
    data = await get_json(
        f"{base}/secrets",
        "secrets listSecrets",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return SecretListResult.model_validate(data)


async def get_secret(
    key: str,
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> SecretValue:
    """Fetch a secret by key (vault first when org context present, else env)."""
    base = resolve_secrets_api_base(env)
    data = await get_json(
        f"{base}/secrets/{quote(key, safe='')}",
        "secrets getSecret",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return SecretValue.model_validate(data)


async def put_secret(
    key: str,
    input: dict[str, Any],
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> SecretMeta:
    """Encrypt and store a secret for the active org. Does not return the value."""
    base = resolve_secrets_api_base(env)
    data = await put_json(
        f"{base}/secrets/{quote(key, safe='')}",
        input,
        "secrets putSecret",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return SecretMeta.model_validate(data)


async def delete_secret(
    key: str,
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> DeleteSecretResult:
    """Delete a vault secret for the active org."""
    base = resolve_secrets_api_base(env)
    data = await delete_json(
        f"{base}/secrets/{quote(key, safe='')}",
        "secrets deleteSecret",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return DeleteSecretResult.model_validate(data)

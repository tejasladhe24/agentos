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
    post_json,
    put_json,
    resolve_ext_api_base,
)

SECRETS_ORG_ID_HEADER = "x-agentos-org-id"
SECRETS_USER_ID_HEADER = "x-agentos-user-id"


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
    ownerUserId: str | None = None


class SecretMeta(BaseModel):
    key: str
    rotatedAt: str
    version: int
    expiresAt: str | None = None
    ownerUserId: str | None = None


class DeleteSecretResult(BaseModel):
    key: str
    deleted: bool


class PurgeUserSecretsResult(BaseModel):
    orgId: str
    userId: str
    deleted: int


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
    owner_user_id: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, str] | None:
    merged = dict(headers or {})
    if org_id:
        merged[SECRETS_ORG_ID_HEADER] = org_id
    if owner_user_id:
        merged[SECRETS_USER_ID_HEADER] = owner_user_id
    return merged or None


def _secret_url(base: str, key: str, owner_user_id: str | None) -> str:
    url = f"{base}/secrets/{quote(key, safe='')}"
    if owner_user_id:
        url += f"?ownerUserId={quote(owner_user_id, safe='')}"
    return url


async def list_secrets(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> SecretListResult:
    """List org-owned vault secret metadata (no plaintext; user-owned excluded)."""
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
    owner_user_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> SecretValue:
    """Fetch a secret by key (vault first when org context present, else env).

    `owner_user_id` addresses a user-owned secret (vault only, no env fallback);
    only forward the user of the current request, never from background jobs.
    """
    base = resolve_secrets_api_base(env)
    data = await get_json(
        _secret_url(base, key, owner_user_id),
        "secrets getSecret",
        headers=_headers(org_id=org_id, owner_user_id=owner_user_id, headers=headers),
    )
    return SecretValue.model_validate(data)


async def put_secret(
    key: str,
    input: dict[str, Any],
    *,
    org_id: str | None = None,
    owner_user_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> SecretMeta:
    """Encrypt and store a secret for the active org. Does not return the value."""
    base = resolve_secrets_api_base(env)
    data = await put_json(
        _secret_url(base, key, owner_user_id),
        input,
        "secrets putSecret",
        headers=_headers(org_id=org_id, owner_user_id=owner_user_id, headers=headers),
    )
    return SecretMeta.model_validate(data)


async def delete_secret(
    key: str,
    *,
    org_id: str | None = None,
    owner_user_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> DeleteSecretResult:
    """Delete a vault secret for the active org."""
    base = resolve_secrets_api_base(env)
    data = await delete_json(
        _secret_url(base, key, owner_user_id),
        "secrets deleteSecret",
        headers=_headers(org_id=org_id, owner_user_id=owner_user_id, headers=headers),
    )
    return DeleteSecretResult.model_validate(data)


async def purge_user_secrets(
    user_id: str,
    *,
    org_id: str,
    env: EnvMap | None = None,
) -> PurgeUserSecretsResult:
    """Delete every user-owned secret of `user_id` in `org_id` (member offboarding)."""
    base = resolve_secrets_api_base(env)
    data = await post_json(
        f"{base}/users/{quote(user_id, safe='')}/purge",
        {},
        "secrets purgeUserSecrets",
        headers=_headers(org_id=org_id),
    )
    return PurgeUserSecretsResult.model_validate(data)

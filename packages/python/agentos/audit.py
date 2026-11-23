"""agentos.audit — HTTP client for builtin `audit` (ticket 82)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from pydantic import BaseModel, Field

from agentos.http import EnvMap, get_json, post_json, resolve_ext_api_base


def resolve_audit_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin audit API base (`…/api/ext/audit` or test override)."""
    return resolve_ext_api_base("audit", "AGENT_OS_AUDIT_API_BASE", env)


class AuditEntryInput(BaseModel):
    action: str
    actor: str | None = None
    resource: str | None = None
    meta: dict[str, Any] | None = None


class AuditEntry(AuditEntryInput):
    id: str
    at: str


class ListEntriesResult(BaseModel):
    entries: list[AuditEntry] = Field(default_factory=list)


async def append_entry(
    input: AuditEntryInput | dict[str, Any],
    env: EnvMap | None = None,
) -> AuditEntry:
    """Append an audit entry (`POST /entries`)."""
    base = resolve_audit_api_base(env)
    body = (
        input.model_dump(exclude_none=True)
        if isinstance(input, AuditEntryInput)
        else input
    )
    data = await post_json(f"{base}/entries", body, "audit appendEntry")
    return AuditEntry.model_validate(data)


async def list_entries(
    limit: int | None = None,
    env: EnvMap | None = None,
) -> list[AuditEntry]:
    """List recent audit entries (`GET /entries?limit=`)."""
    base = resolve_audit_api_base(env)
    url = (
        f"{base}/entries?limit={quote(str(limit), safe='')}"
        if limit is not None
        else f"{base}/entries"
    )
    data = await get_json(url, "audit listEntries")
    return ListEntriesResult.model_validate(data).entries

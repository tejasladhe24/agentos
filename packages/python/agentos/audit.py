"""agentos.audit — HTTP client for builtin `audit` (tickets 82 / 97)."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

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
    orgId: str | None = None


class ListEntriesOptions(BaseModel):
    action: str | None = None
    actor: str | None = None
    resource: str | None = None
    q: str | None = None
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    limit: int | None = None
    cursor: str | None = None

    model_config = {"populate_by_name": True}


class ListEntriesResult(BaseModel):
    entries: list[AuditEntry] = Field(default_factory=list)
    nextCursor: str | None = None


async def append_entry(
    input: AuditEntryInput | dict[str, Any],
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
) -> AuditEntry:
    """Append an audit entry (`POST /entries`)."""
    base = resolve_audit_api_base(env)
    body = (
        input.model_dump(exclude_none=True)
        if isinstance(input, AuditEntryInput)
        else input
    )
    headers = {"X-AgentOS-Org-Id": org_id} if org_id else None
    data = await post_json(
        f"{base}/entries",
        body,
        "audit appendEntry",
        headers=headers,
    )
    return AuditEntry.model_validate(data)


async def list_entries(
    options: ListEntriesOptions | dict[str, Any] | int | None = None,
    env: EnvMap | None = None,
    *,
    org_id: str | None = None,
) -> ListEntriesResult:
    """List audit entries (`GET /entries` with filters / opaque cursor)."""
    base = resolve_audit_api_base(env)
    if options is None:
        opts: dict[str, Any] = {}
    elif isinstance(options, int):
        opts = {"limit": options}
    elif isinstance(options, ListEntriesOptions):
        opts = options.model_dump(exclude_none=True, by_alias=True)
    else:
        opts = {k: v for k, v in options.items() if v is not None}

    qs = urlencode({k: str(v) for k, v in opts.items()})
    url = f"{base}/entries?{qs}" if qs else f"{base}/entries"
    headers = {"X-AgentOS-Org-Id": org_id} if org_id else None
    data = await get_json(url, "audit listEntries", headers=headers)
    return ListEntriesResult.model_validate(data)

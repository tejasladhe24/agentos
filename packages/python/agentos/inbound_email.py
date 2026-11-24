"""agentos.inbound_email — HTTP client for builtin `inbound-email` (ticket 99)."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urlencode

from pydantic import BaseModel, Field

from agentos.http import EnvMap, get_json, json_fetch, post_json, resolve_ext_api_base

INBOUND_EMAIL_ORG_ID_HEADER = "x-agentos-org-id"


def resolve_inbound_email_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin inbound-email API base."""
    return resolve_ext_api_base(
        "inbound-email",
        "AGENT_OS_INBOUND_EMAIL_API_BASE",
        env,
    )


class StoredAttachment(BaseModel):
    filename: str
    contentType: str
    key: str
    ref: str | None = None
    """Canonical `files://<mountId>/<path>` reference (ticket 110)."""
    mountId: str | None = None
    bytes: int


class InboundMessage(BaseModel):
    id: str
    orgId: str
    deliveryId: str
    provider: str
    from_: str = Field(alias="from")
    to: list[str] = Field(default_factory=list)
    subject: str
    text: str | None = None
    html: str | None = None
    attachments: list[StoredAttachment] = Field(default_factory=list)
    receivedAt: str
    readAt: str | None = None

    model_config = {"populate_by_name": True}


class InboundAddress(BaseModel):
    id: str
    address: str
    orgId: str
    purpose: str | None = None
    createdAt: str


class ListMessagesResult(BaseModel):
    messages: list[InboundMessage] = Field(default_factory=list)


class GetMessageResult(BaseModel):
    message: InboundMessage


class ListAddressesResult(BaseModel):
    addresses: list[InboundAddress] = Field(default_factory=list)


class ProvisionAddressResult(BaseModel):
    ok: bool
    address: InboundAddress


def _headers(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, str] | None:
    merged = dict(headers or {})
    if org_id:
        merged[INBOUND_EMAIL_ORG_ID_HEADER] = org_id
    return merged or None


async def list_messages(
    *,
    limit: int | None = None,
    offset: int | None = None,
    from_: str | None = None,
    to: str | None = None,
    q: str | None = None,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> list[InboundMessage]:
    """List inbound messages (`GET /messages`)."""
    base = resolve_inbound_email_api_base(env)
    params: dict[str, str] = {}
    if limit is not None:
        params["limit"] = str(limit)
    if offset is not None:
        params["offset"] = str(offset)
    if from_:
        params["from"] = from_
    if to:
        params["to"] = to
    if q:
        params["q"] = q
    qs = f"?{urlencode(params)}" if params else ""
    data = await get_json(
        f"{base}/messages{qs}",
        "inbound-email listMessages",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return ListMessagesResult.model_validate(data).messages


async def get_message(
    id: str,
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> InboundMessage:
    """Get one inbound message (`GET /messages/:id`)."""
    base = resolve_inbound_email_api_base(env)
    data = await get_json(
        f"{base}/messages/{quote(id, safe='')}",
        "inbound-email getMessage",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return GetMessageResult.model_validate(data).message


async def mark_message_read(
    id: str,
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> InboundMessage:
    """Mark message read (`PATCH /messages/:id`)."""
    base = resolve_inbound_email_api_base(env)
    data = await json_fetch(
        f"{base}/messages/{quote(id, safe='')}",
        method="PATCH",
        body={"read": True},
        headers=_headers(org_id=org_id, headers=headers),
        label="inbound-email markMessageRead",
    )
    return GetMessageResult.model_validate(data).message


async def list_addresses(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> list[InboundAddress]:
    """List inbound addresses (`GET /addresses`)."""
    base = resolve_inbound_email_api_base(env)
    data = await get_json(
        f"{base}/addresses",
        "inbound-email listAddresses",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return ListAddressesResult.model_validate(data).addresses


async def provision_address(
    input: dict[str, Any],
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> InboundAddress:
    """Provision an inbound address (`POST /addresses`)."""
    base = resolve_inbound_email_api_base(env)
    data = await post_json(
        f"{base}/addresses",
        input,
        "inbound-email provisionAddress",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return ProvisionAddressResult.model_validate(data).address

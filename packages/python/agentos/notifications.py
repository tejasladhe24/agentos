"""agentos.notifications — HTTP client for builtin `notifications` (ticket 82)."""

from __future__ import annotations

from typing import Any, Literal
from urllib.parse import quote

from pydantic import BaseModel, Field

from agentos.http import EnvMap, get_json, post_json, resolve_ext_api_base

NOTIFICATIONS_ORG_ID_HEADER = "x-agentos-org-id"

NotificationType = Literal["info", "success", "error"]
DeliveryChannel = Literal["in_app", "email", "sms"]
DeliveryStatus = Literal["queued", "sent", "failed"]


def resolve_notifications_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin notifications API base."""
    return resolve_ext_api_base(
        "notifications",
        "AGENT_OS_NOTIFICATIONS_API_BASE",
        env,
    )


class NotificationEntry(BaseModel):
    id: str
    message: str
    type: NotificationType
    channel: DeliveryChannel
    status: DeliveryStatus
    at: str
    to: str | None = None
    templateId: str | None = None
    subject: str | None = None
    orgId: str | None = None
    provider: str | None = None
    error: str | None = None
    sentAt: str | None = None


class NotifyInput(BaseModel):
    channel: DeliveryChannel
    message: str | None = None
    subject: str | None = None
    type: NotificationType | None = None
    templateId: str | None = None
    vars: dict[str, str] | None = None
    to: str | None = None
    orgId: str | None = None


class NotifyResult(BaseModel):
    ok: bool
    notification: NotificationEntry


class ListRecentResult(BaseModel):
    notifications: list[NotificationEntry] = Field(default_factory=list)


class GetDeliveryResult(BaseModel):
    notification: NotificationEntry


def _headers(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, str] | None:
    merged = dict(headers or {})
    if org_id:
        merged[NOTIFICATIONS_ORG_ID_HEADER] = org_id
    return merged or None


async def notify(
    input: NotifyInput | dict[str, Any],
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> NotifyResult:
    """Enqueue a notification (`POST /notify`)."""
    base = resolve_notifications_api_base(env)
    body = (
        input.model_dump(exclude_none=True)
        if isinstance(input, NotifyInput)
        else input
    )
    data = await post_json(
        f"{base}/notify",
        body,
        "notifications notify",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return NotifyResult.model_validate(data)


async def list_recent(
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> list[NotificationEntry]:
    """Recent in-app inbox (`GET /recent`)."""
    base = resolve_notifications_api_base(env)
    data = await get_json(
        f"{base}/recent",
        "notifications listRecent",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return ListRecentResult.model_validate(data).notifications


async def get_delivery(
    id: str,
    *,
    org_id: str | None = None,
    headers: dict[str, str] | None = None,
    env: EnvMap | None = None,
) -> NotificationEntry:
    """Delivery status by id (`GET /deliveries/:id`)."""
    base = resolve_notifications_api_base(env)
    data = await get_json(
        f"{base}/deliveries/{quote(id, safe='')}",
        "notifications getDelivery",
        headers=_headers(org_id=org_id, headers=headers),
    )
    return GetDeliveryResult.model_validate(data).notification

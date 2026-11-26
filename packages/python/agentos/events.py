"""agentos.events — HTTP client for builtin `events` (ticket 82)."""

from __future__ import annotations

import os
from typing import Any, Literal
from urllib.parse import quote, urlencode

from pydantic import BaseModel, Field

from agentos.http import (
    EnvMap,
    delete_json,
    get_json,
    post_json,
    resolve_ext_api_base,
)


EVENTS_SERVICE_TOKEN_ENV = "AGENT_OS_EVENTS_SERVICE_TOKEN"
EVENTS_ORG_HEADER = "x-agentos-org-id"


def resolve_events_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin events API base (`…/api/ext/events` or test override)."""
    return resolve_ext_api_base("events", "AGENT_OS_EVENTS_API_BASE", env)


def events_service_headers(
    env: EnvMap | None = None,
    org_id: str | None = None,
) -> dict[str, str]:
    """Auth headers for service-to-service calls to builtin `events`.

    `agentos dev` / `agentos start` export `AGENT_OS_EVENTS_SERVICE_TOKEN` to
    every child process. Pass `org_id` to scope the call to one tenant; omit it
    for platform scope.
    """
    source = env if env is not None else os.environ
    headers: dict[str, str] = {}
    token = (source.get(EVENTS_SERVICE_TOKEN_ENV) or "").strip()
    if token:
        headers["authorization"] = f"Bearer {token}"
    if org_id:
        headers[EVENTS_ORG_HEADER] = org_id
    return headers


class EventMessage(BaseModel):
    id: str | None = None
    topic: str
    payload: Any = None
    at: str


class PublishResult(BaseModel):
    ok: bool
    event: EventMessage


class OutboxMessage(BaseModel):
    id: str
    topic: str
    payload: Any = None
    status: Literal["pending", "leased", "acked", "dead"]
    attempts: int
    availableAt: str
    createdAt: str
    leaseOwner: str | None = None
    leaseUntil: str | None = None
    lastError: str | None = None
    ackedAt: str | None = None


class ScheduleJobInput(BaseModel):
    kind: Literal["at", "cron"]
    action: Literal["publish", "http"]
    runAt: str | None = None
    cron: str | None = None
    topic: str | None = None
    payload: Any = None
    url: str | None = None
    body: Any = None
    enabled: bool | None = None


class ScheduledJob(ScheduleJobInput):
    id: str
    enabled: bool
    nextRunAt: str
    createdAt: str
    lastRunAt: str | None = None
    lastError: str | None = None


class ClaimResult(BaseModel):
    messages: list[OutboxMessage] = Field(default_factory=list)


class AckResult(BaseModel):
    message: OutboxMessage


class ListJobsResult(BaseModel):
    jobs: list[ScheduledJob] = Field(default_factory=list)


async def publish(
    topic: str,
    payload: Any = None,
    env: EnvMap | None = None,
    org_id: str | None = None,
) -> PublishResult:
    base = resolve_events_api_base(env)
    data = await post_json(
        f"{base}/publish",
        {"topic": topic, "payload": payload},
        "events publish",
        headers=events_service_headers(env, org_id),
    )
    return PublishResult.model_validate(data)


def subscribe_url(topics: str | list[str], env: EnvMap | None = None) -> str:
    """Build SSE subscribe URL (long-lived connection left to the caller).

    Send `events_service_headers(env)` with the request; `subscribe` needs auth.
    """
    base = resolve_events_api_base(env)
    topic_list = [topics] if isinstance(topics, str) else list(topics)
    if len(topic_list) == 1 and topic_list[0]:
        query = urlencode({"topic": topic_list[0]})
    else:
        query = urlencode([("topics", t) for t in topic_list])
    return f"{base}/subscribe?{query}"


async def claim(limit: int = 1, env: EnvMap | None = None) -> ClaimResult:
    base = resolve_events_api_base(env)
    data = await post_json(
        f"{base}/queue/claim",
        {"limit": limit},
        "events claim",
        headers=events_service_headers(env),
    )
    return ClaimResult.model_validate(data)


async def ack(id: str, env: EnvMap | None = None) -> AckResult:
    base = resolve_events_api_base(env)
    data = await post_json(
        f"{base}/queue/ack",
        {"id": id},
        "events ack",
        headers=events_service_headers(env),
    )
    return AckResult.model_validate(data)


async def nack(
    id: str,
    error: str | None = None,
    env: EnvMap | None = None,
) -> AckResult:
    base = resolve_events_api_base(env)
    body: dict[str, Any] = {"id": id}
    if error:
        body["error"] = error
    data = await post_json(
        f"{base}/queue/nack",
        body,
        "events nack",
        headers=events_service_headers(env),
    )
    return AckResult.model_validate(data)


async def schedule_job(
    input: ScheduleJobInput | dict[str, Any],
    env: EnvMap | None = None,
) -> ScheduledJob:
    base = resolve_events_api_base(env)
    body = (
        input.model_dump(exclude_none=True)
        if isinstance(input, ScheduleJobInput)
        else input
    )
    data = await post_json(
        f"{base}/jobs",
        body,
        "events schedule",
        headers=events_service_headers(env),
    )
    return ScheduledJob.model_validate(data)


async def list_jobs(env: EnvMap | None = None) -> list[ScheduledJob]:
    base = resolve_events_api_base(env)
    data = await get_json(
        f"{base}/jobs",
        "events list jobs",
        headers=events_service_headers(env),
    )
    return ListJobsResult.model_validate(data).jobs


async def delete_job(id: str, env: EnvMap | None = None) -> dict[str, Any]:
    base = resolve_events_api_base(env)
    data = await delete_json(
        f"{base}/jobs/{quote(id, safe='')}",
        "events delete job",
        headers=events_service_headers(env),
    )
    return data if isinstance(data, dict) else {"ok": True}

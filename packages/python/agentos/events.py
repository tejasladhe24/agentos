"""agentos.events — HTTP client for builtin `events` (ticket 82)."""

from __future__ import annotations

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


def resolve_events_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin events API base (`…/api/ext/events` or test override)."""
    return resolve_ext_api_base("events", "AGENT_OS_EVENTS_API_BASE", env)


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
) -> PublishResult:
    base = resolve_events_api_base(env)
    data = await post_json(
        f"{base}/publish",
        {"topic": topic, "payload": payload},
        "events publish",
    )
    return PublishResult.model_validate(data)


def subscribe_url(topics: str | list[str], env: EnvMap | None = None) -> str:
    """Build SSE subscribe URL (long-lived connection left to the caller)."""
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
    )
    return ClaimResult.model_validate(data)


async def ack(id: str, env: EnvMap | None = None) -> AckResult:
    base = resolve_events_api_base(env)
    data = await post_json(
        f"{base}/queue/ack",
        {"id": id},
        "events ack",
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
    data = await post_json(f"{base}/queue/nack", body, "events nack")
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
    data = await post_json(f"{base}/jobs", body, "events schedule")
    return ScheduledJob.model_validate(data)


async def list_jobs(env: EnvMap | None = None) -> list[ScheduledJob]:
    base = resolve_events_api_base(env)
    data = await get_json(f"{base}/jobs", "events list jobs")
    return ListJobsResult.model_validate(data).jobs


async def delete_job(id: str, env: EnvMap | None = None) -> dict[str, Any]:
    base = resolve_events_api_base(env)
    data = await delete_json(
        f"{base}/jobs/{quote(id, safe='')}",
        "events delete job",
    )
    return data if isinstance(data, dict) else {"ok": True}

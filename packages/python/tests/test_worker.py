"""Tests for agentos.worker (ticket 80)."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from agentos import create_app, worker
from agentos.worker import WorkerPool, WorkerTimeoutError, reset_default_pool


@pytest.fixture(autouse=True)
def _reset_pool() -> None:
    reset_default_pool()
    yield
    reset_default_pool()


def test_health_still_registers() -> None:
    app = create_app()
    client = TestClient(app)
    assert client.get("/health").json() == {"ok": True}


def test_concurrency_limit_from_env() -> None:
    assert worker.concurrency_limit({worker.CONCURRENCY_ENV: "3"}) == 3
    assert worker.concurrency_limit({}) == 1


def test_timeout_seconds_from_env() -> None:
    assert worker.timeout_seconds({worker.TIMEOUT_SECONDS_ENV: "12"}) == 12.0
    assert worker.timeout_seconds({}) is None


@pytest.mark.asyncio
async def test_concurrency_one_serializes_jobs() -> None:
    pool = WorkerPool(concurrency=1, timeout=None)
    active = 0
    max_active = 0
    lock = asyncio.Lock()

    async def job() -> None:
        nonlocal active, max_active
        async with lock:
            active += 1
            max_active = max(max_active, active)
        await asyncio.sleep(0.05)
        async with lock:
            active -= 1

    await asyncio.gather(pool.run(job), pool.run(job), pool.run(job))
    assert max_active == 1


@pytest.mark.asyncio
async def test_timeout_raises() -> None:
    pool = WorkerPool(concurrency=1, timeout=0.05)

    async def slow() -> None:
        await asyncio.sleep(1)

    with pytest.raises(WorkerTimeoutError):
        await pool.run(slow)

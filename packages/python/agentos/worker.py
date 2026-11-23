"""Worker helpers — concurrency + per-job timeout for long jobs (ticket 80)."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Awaitable, Callable, Coroutine
from typing import TypeVar

T = TypeVar("T")

CONCURRENCY_ENV = "AGENT_OS_WORKER_CONCURRENCY"
TIMEOUT_SECONDS_ENV = "AGENT_OS_WORKER_TIMEOUT_SECONDS"


class WorkerTimeoutError(TimeoutError):
    """Raised when a worker job exceeds ``AGENT_OS_WORKER_TIMEOUT_SECONDS``."""


def _positive_int(raw: str | None, default: int) -> int:
    if raw is None or raw.strip() == "":
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value >= 1 else default


def concurrency_limit(env: dict[str, str] | None = None) -> int:
    """Max overlapping jobs from env (default 1)."""
    source = env if env is not None else os.environ
    return _positive_int(source.get(CONCURRENCY_ENV), 1)


def timeout_seconds(env: dict[str, str] | None = None) -> float | None:
    """
    Per-job timeout in seconds from env.

    ``None`` when unset or invalid (no timeout).
    """
    source = env if env is not None else os.environ
    raw = source.get(TIMEOUT_SECONDS_ENV)
    if raw is None or raw.strip() == "":
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if value > 0 else None


class WorkerPool:
    """
    Process-local semaphore + optional timeout for long-running jobs.

    Reads ``AGENT_OS_WORKER_CONCURRENCY`` and ``AGENT_OS_WORKER_TIMEOUT_SECONDS``
    (injected by ``agentos dev`` / ``agentos start`` from ``meta.json``).
    """

    def __init__(
        self,
        *,
        concurrency: int | None = None,
        timeout: float | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        limit = concurrency if concurrency is not None else concurrency_limit(env)
        if limit < 1:
            limit = 1
        self._concurrency = limit
        self._timeout = timeout if timeout is not None else timeout_seconds(env)
        self._sem = asyncio.Semaphore(limit)

    @property
    def concurrency(self) -> int:
        return self._concurrency

    @property
    def timeout(self) -> float | None:
        return self._timeout

    async def run(
        self,
        job: Callable[[], Awaitable[T]] | Callable[[], Coroutine[object, object, T]],
    ) -> T:
        """Run ``job`` under the pool semaphore and optional timeout."""
        async with self._sem:
            awaitable = job()
            if self._timeout is None:
                return await awaitable
            try:
                return await asyncio.wait_for(awaitable, timeout=self._timeout)
            except TimeoutError as exc:
                raise WorkerTimeoutError(
                    f"worker job exceeded {self._timeout}s"
                ) from exc


_default_pool: WorkerPool | None = None


def get_pool(*, env: dict[str, str] | None = None) -> WorkerPool:
    """Process-wide pool (lazily created from current env)."""
    global _default_pool
    if env is not None:
        return WorkerPool(env=env)
    if _default_pool is None:
        _default_pool = WorkerPool()
    return _default_pool


async def run_job(
    job: Callable[[], Awaitable[T]] | Callable[[], Coroutine[object, object, T]],
    *,
    pool: WorkerPool | None = None,
) -> T:
    """Convenience wrapper around :meth:`WorkerPool.run`."""
    return await (pool or get_pool()).run(job)


def reset_default_pool() -> None:
    """Clear the process-wide pool (tests)."""
    global _default_pool
    _default_pool = None

"""agentos.webhook — inbound webhook helpers for Python services (ticket 78).

Mirrors `@agentos/core/api/webhook`: HMAC-SHA256 verify, timestamp skew, and
idempotency via `cache_store`. Provider-specific header names stay in the service.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Any, Awaitable, Callable, Literal, TypeVar

from agentos.store import cache_store

T = TypeVar("T")

SignatureEncoding = Literal["hex", "base64", "base64url"]


class WebhookVerifyError(Exception):
    """Raised when signature or timestamp checks fail."""

    def __init__(self, code: Literal["signature", "timestamp"], message: str) -> None:
        super().__init__(message)
        self.code = code


def _strip_prefix(signature: str, prefix: str | None) -> str:
    trimmed = signature.strip()
    if prefix and trimmed.startswith(prefix):
        return trimmed[len(prefix) :].strip()
    return trimmed


def _expected_hmac(
    secret: str,
    raw_body: bytes | str,
    encoding: SignatureEncoding,
) -> str:
    body = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    if encoding == "base64":
        import base64

        return base64.b64encode(digest).decode("ascii")
    if encoding == "base64url":
        import base64

        return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return digest.hex()


def verify_webhook_signature(
    *,
    raw_body: bytes | str,
    secret: str,
    signature: str,
    encoding: SignatureEncoding = "hex",
    prefix: str | None = None,
) -> bool:
    """Timing-safe HMAC-SHA256 check. Returns False on mismatch/empty inputs."""
    provided = _strip_prefix(signature, prefix)
    if not secret or not provided:
        return False
    expected = _expected_hmac(secret, raw_body, encoding)
    return hmac.compare_digest(expected, provided)


def verify_timestamp_skew(
    *,
    timestamp: int | float | str,
    skew_seconds: int = 300,
    now_seconds: int | None = None,
) -> bool:
    """Reject timestamps outside the skew window (replay protection)."""
    if skew_seconds < 0:
        return False
    try:
        raw = float(timestamp)
    except (TypeError, ValueError):
        return False
    if abs(raw) >= 1e12:
        raw = int(raw // 1000)
    else:
        raw = int(raw)
    now = now_seconds if now_seconds is not None else int(time.time())
    return abs(now - raw) <= skew_seconds


async def with_idempotency(
    *,
    key: str,
    run: Callable[[], Awaitable[T]],
    ttl_seconds: int = 86_400,
) -> dict[str, Any]:
    """Run `run` at most once per key; duplicates return the cached result."""
    trimmed = key.strip()
    if not trimmed:
        raise ValueError("with_idempotency: key must be a non-empty string")
    cache_key = f"webhook:idempotency:{trimmed}"
    existing = await cache_store.get(cache_key)
    if existing is not None:
        return {"status": "duplicate", "result": existing}
    result = await run()
    await cache_store.set(cache_key, result, ttl_seconds)
    return {"status": "executed", "result": result}


async def verify_and_handle_webhook(
    *,
    raw_body: bytes | str,
    secret: str,
    signature: str,
    idempotency_key: str,
    encoding: SignatureEncoding = "hex",
    prefix: str | None = None,
    timestamp: int | float | str | None = None,
    skew_seconds: int = 300,
    now_seconds: int | None = None,
    ttl_seconds: int = 86_400,
    run: Callable[[], Awaitable[T]],
) -> dict[str, Any]:
    """Verify signature (+ optional timestamp), then run with idempotency."""
    if not verify_webhook_signature(
        raw_body=raw_body,
        secret=secret,
        signature=signature,
        encoding=encoding,
        prefix=prefix,
    ):
        raise WebhookVerifyError("signature", "webhook signature mismatch")
    if timestamp is not None and not verify_timestamp_skew(
        timestamp=timestamp,
        skew_seconds=skew_seconds,
        now_seconds=now_seconds,
    ):
        raise WebhookVerifyError("timestamp", "webhook timestamp out of skew")
    return await with_idempotency(
        key=idempotency_key,
        run=run,
        ttl_seconds=ttl_seconds,
    )

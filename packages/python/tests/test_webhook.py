"""Tests for agentos.webhook helpers."""

from __future__ import annotations

import hashlib
import hmac
import time

import httpx
import pytest
import respx

from agentos.webhook import (
    WebhookVerifyError,
    verify_and_handle_webhook,
    verify_timestamp_skew,
    verify_webhook_signature,
    with_idempotency,
)


def _hex_sig(secret: str, body: str) -> str:
    return hmac.new(secret.encode(), body.encode(), hashlib.sha256).hexdigest()


def test_verify_webhook_signature_ok_and_fail() -> None:
    secret = "whsec"
    body = '{"id":"1"}'
    sig = _hex_sig(secret, body)
    assert verify_webhook_signature(raw_body=body, secret=secret, signature=sig)
    assert not verify_webhook_signature(
        raw_body=body, secret=secret, signature="deadbeef"
    )
    assert verify_webhook_signature(
        raw_body=body,
        secret=secret,
        signature=f"sha256={sig}",
        prefix="sha256=",
    )


def test_verify_timestamp_skew() -> None:
    now = int(time.time())
    assert verify_timestamp_skew(timestamp=now - 10, skew_seconds=60, now_seconds=now)
    assert not verify_timestamp_skew(
        timestamp=now - 120, skew_seconds=60, now_seconds=now
    )


@pytest.mark.asyncio
@respx.mock
async def test_with_idempotency_dedupes(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_CACHE_STORE_API_BASE", "http://cache.test")
    store: dict[str, object] = {}

    def on_get(request: httpx.Request) -> httpx.Response:
        import json

        key = json.loads(request.content.decode())["key"]
        if key not in store:
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json={"key": key, "value": store[key]})

    def on_set(request: httpx.Request) -> httpx.Response:
        import json

        body = json.loads(request.content.decode())
        store[body["key"]] = body["value"]
        return httpx.Response(200, json={"ok": True})

    respx.post("http://cache.test/get").mock(side_effect=on_get)
    respx.post("http://cache.test/set").mock(side_effect=on_set)

    runs = 0

    async def run() -> dict[str, int]:
        nonlocal runs
        runs += 1
        return {"n": runs}

    first = await with_idempotency(key="evt_1", run=run)
    second = await with_idempotency(key="evt_1", run=run)
    assert first == {"status": "executed", "result": {"n": 1}}
    assert second == {"status": "duplicate", "result": {"n": 1}}
    assert runs == 1


@pytest.mark.asyncio
async def test_verify_and_handle_rejects_bad_signature() -> None:
    with pytest.raises(WebhookVerifyError) as exc:
        await verify_and_handle_webhook(
            raw_body="{}",
            secret="s",
            signature="bad",
            idempotency_key="k",
            run=async_ok,
        )
    assert exc.value.code == "signature"


async def async_ok() -> dict[str, bool]:
    return {"ok": True}

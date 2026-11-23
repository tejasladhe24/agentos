"""Tests for files / events / audit / secrets / notifications clients (ticket 82)."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentos import audit, events, files, notifications, secrets


@pytest.mark.asyncio
@respx.mock
async def test_files_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_FILES_API_BASE", "http://files.test")

    respx.put("http://files.test/blobs/doc%2F1").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "key": "doc/1", "bytes": 1},
        ),
    )

    def _get_blob(request: httpx.Request) -> httpx.Response:
        if request.url.params.get("format") == "json":
            return httpx.Response(
                200,
                json={"key": "doc/1", "base64": "YQ==", "bytes": 1},
            )
        return httpx.Response(200, content=b"a")

    respx.get(url__regex=r"http://files\.test/blobs/doc%2F1.*").mock(
        side_effect=_get_blob,
    )
    respx.delete("http://files.test/blobs/doc%2F1").mock(
        return_value=httpx.Response(200, json={"ok": True, "key": "doc/1"}),
    )

    put = await files.put_blob("doc/1", "YQ==")
    assert put.key == "doc/1"
    assert put.bytes == 1

    raw = await files.get_blob("doc/1")
    assert raw == b"a"

    b64 = await files.get_blob_base64("doc/1")
    assert b64.base64 == "YQ=="
    assert files.decode_base64(b64.base64) == b"a"

    deleted = await files.delete_blob("doc/1")
    assert deleted.ok is True
    assert deleted.key == "doc/1"

    respx.get("http://files.test/blobs").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "key": "orgs/o/doc/1",
                        "name": "1",
                        "kind": "file",
                        "relativeKey": "doc/1",
                    },
                ],
                "cursor": None,
                "prefix": "",
            },
        ),
    )
    listed = await files.list_blobs(org_id="o")
    assert listed.items[0].name == "1"

    respx.post("http://files.test/blobs/move").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "from": "a", "to": "b"},
        ),
    )
    moved = await files.move_blob("a", "b", org_id="o")
    assert moved.ok is True
    assert moved.to == "b"


@pytest.mark.asyncio
@respx.mock
async def test_events_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_EVENTS_API_BASE", "http://events.test")

    respx.post("http://events.test/publish").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "event": {
                    "id": "e1",
                    "topic": "orders",
                    "payload": {"id": 1},
                    "at": "2026-01-01T00:00:00.000Z",
                },
            },
        ),
    )
    respx.post("http://events.test/queue/claim").mock(
        return_value=httpx.Response(
            200,
            json={
                "messages": [
                    {
                        "id": "m1",
                        "topic": "orders",
                        "payload": {},
                        "status": "leased",
                        "attempts": 0,
                        "availableAt": "2026-01-01T00:00:00.000Z",
                        "createdAt": "2026-01-01T00:00:00.000Z",
                    },
                ],
            },
        ),
    )
    respx.post("http://events.test/queue/ack").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {
                    "id": "m1",
                    "topic": "orders",
                    "payload": {},
                    "status": "acked",
                    "attempts": 0,
                    "availableAt": "2026-01-01T00:00:00.000Z",
                    "createdAt": "2026-01-01T00:00:00.000Z",
                },
            },
        ),
    )
    respx.post("http://events.test/jobs").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "j1",
                "kind": "cron",
                "cron": "@every 30s",
                "action": "publish",
                "topic": "heartbeat",
                "enabled": True,
                "nextRunAt": "2026-01-01T00:00:30.000Z",
                "createdAt": "2026-01-01T00:00:00.000Z",
            },
        ),
    )

    published = await events.publish("orders", {"id": 1})
    assert published.event.topic == "orders"
    assert events.subscribe_url("orders") == (
        "http://events.test/subscribe?topic=orders"
    )
    claimed = await events.claim(2)
    assert claimed.messages[0].id == "m1"
    acked = await events.ack("m1")
    assert acked.message.status == "acked"
    job = await events.schedule_job(
        {
            "kind": "cron",
            "cron": "@every 30s",
            "action": "publish",
            "topic": "heartbeat",
        },
    )
    assert job.id == "j1"


@pytest.mark.asyncio
@respx.mock
async def test_audit_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUDIT_API_BASE", "http://audit.test")
    entry = {
        "id": "a1",
        "action": "doc.view",
        "actor": "u1",
        "resource": "doc/1",
        "at": "2026-01-01T00:00:00.000Z",
    }
    respx.post("http://audit.test/entries").mock(
        return_value=httpx.Response(201, json=entry),
    )
    respx.get("http://audit.test/entries?limit=10").mock(
        return_value=httpx.Response(200, json={"entries": [entry]}),
    )

    saved = await audit.append_entry(
        {"action": "doc.view", "actor": "u1", "resource": "doc/1"},
    )
    assert saved.id == "a1"
    listed = await audit.list_entries(10)
    assert listed.entries[0].action == "doc.view"


@pytest.mark.asyncio
@respx.mock
async def test_secrets_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_SECRETS_API_BASE", "http://secrets.test")

    get_route = respx.get("http://secrets.test/secrets/OPENAI_KEY").mock(
        return_value=httpx.Response(
            200,
            json={"key": "OPENAI_KEY", "value": "sk-test"},
        ),
    )
    put_route = respx.put("http://secrets.test/secrets/qbo").mock(
        return_value=httpx.Response(
            200,
            json={"key": "qbo", "rotatedAt": "t", "version": 1},
        ),
    )
    del_route = respx.delete("http://secrets.test/secrets/qbo").mock(
        return_value=httpx.Response(
            200,
            json={"key": "qbo", "deleted": True},
        ),
    )

    value = await secrets.get_secret("OPENAI_KEY")
    assert value.value == "sk-test"
    assert get_route.called

    meta = await secrets.put_secret(
        "qbo",
        {"value": "tok"},
        org_id="org_1",
    )
    assert meta.version == 1
    assert put_route.calls.last.request.headers["x-agentos-org-id"] == "org_1"

    deleted = await secrets.delete_secret("qbo", org_id="org_1")
    assert deleted.deleted is True
    assert del_route.calls.last.request.headers["x-agentos-org-id"] == "org_1"


@pytest.mark.asyncio
@respx.mock
async def test_notifications_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "AGENT_OS_NOTIFICATIONS_API_BASE",
        "http://notify.test",
    )
    notification = {
        "id": "n1",
        "message": "hello",
        "type": "info",
        "channel": "email",
        "status": "sent",
        "at": "2026-01-01T00:00:00.000Z",
        "to": "a@b.co",
        "orgId": "org_1",
    }

    notify_route = respx.post("http://notify.test/notify").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "notification": notification},
        ),
    )
    respx.get("http://notify.test/recent").mock(
        return_value=httpx.Response(
            200,
            json={"notifications": [notification]},
        ),
    )
    respx.get("http://notify.test/deliveries/n1").mock(
        return_value=httpx.Response(
            200,
            json={"notification": notification},
        ),
    )

    sent = await notifications.notify(
        {"channel": "email", "message": "hello", "to": "a@b.co"},
        org_id="org_1",
    )
    assert sent.notification.id == "n1"
    assert notify_route.calls.last.request.headers["x-agentos-org-id"] == "org_1"

    recent = await notifications.list_recent(org_id="org_1")
    assert recent[0].channel == "email"

    delivery = await notifications.get_delivery("n1")
    assert delivery.status == "sent"

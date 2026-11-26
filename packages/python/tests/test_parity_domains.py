"""Tests for files / events / audit / secrets / notifications clients (ticket 82)."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentos import audit, events, files, inbound_email, notifications, secrets


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


def test_file_refs() -> None:
    assert files.format_file_ref("platform", "a/b.txt") == "files://platform/a/b.txt"
    parsed = files.parse_file_ref("files://m_1/x/y.pdf")
    assert parsed is not None
    assert (parsed.mountId, parsed.path) == ("m_1", "x/y.pdf")
    assert files.parse_file_ref("orgs/o/a.txt") is None
    assert files.parse_file_ref("files://bad id/x") is None
    assert files.to_file_ref("orgs/o1/docs/a.txt", "o1") == "files://platform/docs/a.txt"
    assert files.to_file_ref("orgs/o1/docs/a.txt") == "files://platform/docs/a.txt"
    assert files.to_file_ref("docs/a.txt") == "files://platform/docs/a.txt"
    assert files.org_id_from_legacy_key("orgs/o1/a.txt") == "o1"


@pytest.mark.asyncio
@respx.mock
async def test_files_mounts_and_refs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_FILES_API_BASE", "http://files.test")

    put_route = respx.put("http://files.test/blobs/inbound%2Fa.pdf").mock(
        return_value=httpx.Response(
            200,
            json={
                "ok": True,
                "key": "orgs/o/inbound/a.pdf",
                "ref": "files://platform/inbound/a.pdf",
                "mountId": "platform",
                "bytes": 1,
            },
        ),
    )
    put = await files.put_blob("inbound/a.pdf", b"a", org_id="o", mount_id="default")
    assert put_route.calls.last.request.url.params.get("mount") == "default"
    assert put.ref == "files://platform/inbound/a.pdf"

    get_route = respx.get(
        url__regex=r"http://files\.test/blobs/files%3A%2F%2Fplatform%2Finbound%2Fa\.pdf.*",
    ).mock(
        return_value=httpx.Response(
            200,
            json={"key": "orgs/o/inbound/a.pdf", "base64": "YQ==", "bytes": 1},
        ),
    )
    fetched = await files.get_blob_base64(put.ref or "", org_id="o")
    assert fetched.bytes == 1
    assert get_route.called

    copy_route = respx.post("http://files.test/blobs/copy").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "toRef": "files://platform/shared/a.pdf"},
        ),
    )
    copied = await files.copy_blob(
        "files://p_drive/a.pdf",
        "shared/a.pdf",
        org_id="o",
        to_mount="platform",
    )
    assert copied.toRef == "files://platform/shared/a.pdf"
    assert b'"toMount":"platform"' in copy_route.calls.last.request.content.replace(
        b" ", b""
    )

    respx.get("http://files.test/mounts").mock(
        return_value=httpx.Response(
            200,
            json={
                "mounts": [
                    {
                        "id": "platform",
                        "kind": "org",
                        "provider": "filesystem",
                        "name": "Platform storage",
                        "isDefault": True,
                        "status": "connected",
                        "builtin": True,
                    },
                ],
                "defaultMountId": "platform",
                "providers": [],
                "canManage": False,
            },
        ),
    )
    mounts = await files.list_mounts(org_id="o")
    assert mounts.defaultMountId == "platform"
    assert mounts.mounts[0].builtin is True


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

    list_route = respx.get("http://secrets.test/secrets").mock(
        return_value=httpx.Response(
            200,
            json={
                "orgId": "org_1",
                "canWrite": True,
                "keys": [{"key": "qbo", "updatedAt": "t", "hasValue": True}],
            },
        ),
    )
    listed = await secrets.list_secrets(org_id="org_1")
    assert listed.orgId == "org_1"
    assert listed.canWrite is True
    assert listed.keys[0].key == "qbo"
    assert list_route.calls.last.request.headers["x-agentos-org-id"] == "org_1"

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
async def test_secrets_user_owned(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_SECRETS_API_BASE", "http://secrets.test")
    url = "http://secrets.test/secrets/files%2Fdrive"
    owner = {"ownerUserId": "user_1"}
    get_route = respx.get(url, params=owner).mock(
        return_value=httpx.Response(
            200,
            json={
                "key": "files/drive",
                "value": "tok",
                "source": "vault",
                "ownerUserId": "user_1",
            },
        )
    )
    put_route = respx.put(url, params=owner).mock(
        return_value=httpx.Response(
            201,
            json={
                "key": "files/drive",
                "rotatedAt": "t",
                "version": 1,
                "ownerUserId": "user_1",
            },
        )
    )
    del_route = respx.delete(url, params=owner).mock(
        return_value=httpx.Response(200, json={"key": "files/drive", "deleted": True})
    )
    purge_route = respx.post("http://secrets.test/users/user_1/purge").mock(
        return_value=httpx.Response(
            200, json={"orgId": "org_1", "userId": "user_1", "deleted": 2}
        )
    )

    meta = await secrets.put_secret(
        "files/drive", {"value": "tok"}, org_id="org_1", owner_user_id="user_1"
    )
    assert meta.ownerUserId == "user_1"
    value = await secrets.get_secret("files/drive", org_id="org_1", owner_user_id="user_1")
    assert value.ownerUserId == "user_1"
    await secrets.delete_secret("files/drive", org_id="org_1", owner_user_id="user_1")
    for route in (get_route, put_route, del_route):
        headers = route.calls.last.request.headers
        assert headers["x-agentos-org-id"] == "org_1"
        assert headers["x-agentos-user-id"] == "user_1"

    purged = await secrets.purge_user_secrets("user_1", org_id="org_1")
    assert purged.deleted == 2
    assert purge_route.calls.last.request.headers["x-agentos-org-id"] == "org_1"


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
    respx.get(url__regex=r"http://notify\.test/deliveries\?.*").mock(
        return_value=httpx.Response(
            200,
            json={"notifications": [notification]},
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

    listed = await notifications.list_deliveries(
        channel="email",
        org_id="org_1",
    )
    assert listed[0].id == "n1"


@pytest.mark.asyncio
@respx.mock
async def test_inbound_email_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "AGENT_OS_INBOUND_EMAIL_API_BASE",
        "http://inbound.test",
    )
    message = {
        "id": "m1",
        "orgId": "org_1",
        "deliveryId": "d1",
        "provider": "fixture",
        "from": "a@b.co",
        "to": ["inbox@example.com"],
        "subject": "Hi",
        "attachments": [],
        "receivedAt": "2026-01-01T00:00:00.000Z",
    }
    address = {
        "id": "a1",
        "address": "inbox@example.com",
        "orgId": "org_1",
        "createdAt": "2026-01-01T00:00:00.000Z",
    }

    respx.get("http://inbound.test/messages/m1").mock(
        return_value=httpx.Response(200, json={"message": message}),
    )
    respx.get(url__regex=r"http://inbound\.test/messages(\?.*)?").mock(
        return_value=httpx.Response(200, json={"messages": [message]}),
    )
    respx.patch("http://inbound.test/messages/m1").mock(
        return_value=httpx.Response(
            200,
            json={
                "message": {
                    **message,
                    "readAt": "2026-01-01T00:01:00.000Z",
                }
            },
        ),
    )
    respx.get("http://inbound.test/addresses").mock(
        return_value=httpx.Response(200, json={"addresses": [address]}),
    )
    respx.post("http://inbound.test/addresses").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "address": address},
        ),
    )

    listed = await inbound_email.list_messages(org_id="org_1", q="Hi")
    assert listed[0].id == "m1"
    assert listed[0].from_ == "a@b.co"

    got = await inbound_email.get_message("m1", org_id="org_1")
    assert got.subject == "Hi"

    marked = await inbound_email.mark_message_read("m1", org_id="org_1")
    assert marked.readAt is not None

    addrs = await inbound_email.list_addresses(org_id="org_1")
    assert addrs[0].address == "inbox@example.com"

    provisioned = await inbound_email.provision_address(
        {"address": "inbox@example.com"},
        org_id="org_1",
    )
    assert provisioned.orgId == "org_1"


def test_events_service_headers() -> None:
    env = {"AGENT_OS_EVENTS_SERVICE_TOKEN": " tok-123 "}
    assert events.events_service_headers(env) == {"authorization": "Bearer tok-123"}
    assert events.events_service_headers(env, "org-a") == {
        "authorization": "Bearer tok-123",
        "x-agentos-org-id": "org-a",
    }
    assert events.events_service_headers({}) == {}

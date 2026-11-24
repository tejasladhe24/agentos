"""Tests for agentos.integrations (ticket 103) — parity with the TS kit."""

from __future__ import annotations

import json

import httpx
import pytest
import respx

from agentos import integrations
from agentos.integrations import (
    INTEGRATION_CHANGED_TOPIC,
    HttpIntegrationsBackend,
    IntegrationError,
    MemoryIntegrationsBackend,
    create_integrations_kit,
)

SECRET = "re_live_supersecret_123"


def _from_config(config: dict) -> dict:
    return {"name": config["provider"], "api_key": config["secrets"].get("apiKey")}


def _from_env() -> dict:
    return {"name": "log", "api_key": None}


@pytest.mark.asyncio
async def test_fallback_and_isolation() -> None:
    kit = create_integrations_kit(MemoryIntegrationsBackend())
    await kit.put_integration(
        "org_a",
        integration="email.send",
        provider="resend",
        settings={"from": "a@example.com"},
        secrets={"apiKey": SECRET},
    )
    a = await kit.resolve_provider("org_a", "email.send", _from_config, _from_env)
    assert a.source == "tenant"
    assert a.provider == {"name": "resend", "api_key": SECRET}
    b = await kit.resolve_provider("org_b", "email.send", _from_config, _from_env)
    assert b.source == "platform"
    assert await kit.get_integration("org_b", "email.send") is None


@pytest.mark.asyncio
async def test_put_new_secret_resolves_without_restart() -> None:
    kit = create_integrations_kit(MemoryIntegrationsBackend())
    await kit.put_integration(
        "org_a", integration="ai", provider="openai", secrets={"apiKey": "one"}
    )
    first = await kit.resolve_provider("org_a", "ai", _from_config, _from_env)
    assert first.provider["api_key"] == "one"
    await kit.put_integration(
        "org_a", integration="ai", provider="openai", secrets={"apiKey": "two"}
    )
    second = await kit.resolve_provider("org_a", "ai", _from_config, _from_env)
    assert second.provider["api_key"] == "two"


@pytest.mark.asyncio
async def test_changed_event_invalidates_other_replica() -> None:
    backend = MemoryIntegrationsBackend()
    writer = create_integrations_kit(backend)
    reader = create_integrations_kit(backend)
    await writer.put_integration(
        "org_a", integration="sms", provider="twilio", secrets={"authToken": "t"}
    )
    assert (await reader.resolve_provider("org_a", "sms", _from_config, _from_env)).source == "tenant"
    await writer.delete_integration("org_a", "sms")
    assert (await reader.resolve_provider("org_a", "sms", _from_config, _from_env)).source == "tenant"
    events = [e for e in backend.events if e["topic"] == INTEGRATION_CHANGED_TOPIC]
    reader.handle_changed_event(events[-1]["payload"])
    assert (await reader.resolve_provider("org_a", "sms", _from_config, _from_env)).source == "platform"


@pytest.mark.asyncio
async def test_no_value_leakage_in_reads_events_audit() -> None:
    backend = MemoryIntegrationsBackend()
    kit = create_integrations_kit(backend)
    view = await kit.put_integration(
        "org_a",
        integration="email.send",
        provider="resend",
        secrets={"apiKey": SECRET},
        updated_by="admin",
    )
    assert view["secrets"]["apiKey"]["set"] is True
    listed = await kit.list_integrations("org_a")
    await kit.delete_integration("org_a", "email.send")
    blob = json.dumps(
        {
            "view": view,
            "listed": listed,
            "events": backend.events,
            "audit": backend.audit_log,
        }
    )
    assert SECRET not in blob
    assert [a["action"] for a in backend.audit_log] == [
        "integration.put",
        "integration.delete",
    ]
    assert backend.vault == {}


@pytest.mark.asyncio
async def test_rejects_invalid_ids() -> None:
    kit = create_integrations_kit(MemoryIntegrationsBackend())
    with pytest.raises(IntegrationError):
        await kit.put_integration("org_a", integration="Bad Id", provider="x")


@pytest.mark.asyncio
@respx.mock
async def test_http_backend_uses_peer_header_and_vault_only() -> None:
    respx.post("http://db.test/collections/integrations/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "email.send:default",
                        "data": {
                            "integration": "email.send",
                            "instanceId": "default",
                            "provider": "resend",
                            "settings": {},
                            "secretRefs": {
                                "apiKey": "integrations/email.send/default/apiKey",
                                "other": "integrations/email.send/default/other",
                            },
                            "updatedAt": "2026-01-01T00:00:00.000Z",
                        },
                    }
                ]
            },
        )
    )
    vault_route = respx.get(
        "http://secrets.test/secrets/integrations%2Femail.send%2Fdefault%2FapiKey"
    ).mock(
        return_value=httpx.Response(200, json={"key": "k", "value": "v", "source": "vault"})
    )
    respx.get(
        "http://secrets.test/secrets/integrations%2Femail.send%2Fdefault%2Fother"
    ).mock(
        return_value=httpx.Response(200, json={"key": "k", "value": "e", "source": "env"})
    )
    kit = integrations.IntegrationsKit(
        HttpIntegrationsBackend(
            db_store_api_base="http://db.test",
            secrets_api_base="http://secrets.test",
            publish_events=False,
            write_audit=False,
        )
    )
    resolved = await kit.get_integration("org_a", "email.send")
    assert resolved is not None
    assert resolved["secrets"] == {"apiKey": "v"}
    assert vault_route.calls.last.request.headers["x-agentos-org-id"] == "org_a"

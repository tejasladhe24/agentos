"""Tests for agentos.vector_store client."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentos import vector_store


@pytest.mark.asyncio
@respx.mock
async def test_vector_store_client(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_VECTOR_STORE_API_BASE", "http://vs.test")

    respx.get("http://vs.test/health").mock(
        return_value=httpx.Response(
            200,
            json={"ok": True, "mode": "memory", "dimensions": 4},
        ),
    )
    respx.post("http://vs.test/indexes/policies/upsert").mock(
        return_value=httpx.Response(200, json={"upserted": 1}),
    )
    respx.post("http://vs.test/indexes/policies/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "c1",
                        "score": 0.99,
                        "content": "access",
                        "metadata": {"page": 1},
                    },
                ],
            },
        ),
    )
    respx.post("http://vs.test/indexes/policies/delete").mock(
        return_value=httpx.Response(200, json={"deleted": 1}),
    )

    health = await vector_store.health()
    assert health.mode == "memory"
    assert health.dimensions == 4

    upserted = await vector_store.upsert(
        "policies",
        {
            "items": [
                {"id": "c1", "embedding": [1.0, 0.0, 0.0, 0.0], "content": "access"},
            ],
        },
        org_id="org_a",
    )
    assert upserted.upserted == 1

    route = respx.calls[-1]
    assert route.request.headers.get("x-agentos-org-id") == "org_a"

    hits = await vector_store.query(
        "policies",
        {"embedding": [1.0, 0.0, 0.0, 0.0], "topK": 3},
        org_id="org_a",
    )
    assert hits.items[0].id == "c1"
    assert hits.items[0].score == 0.99

    deleted = await vector_store.delete(
        "policies",
        {"ids": ["c1"]},
        org_id="org_a",
    )
    assert deleted.deleted == 1

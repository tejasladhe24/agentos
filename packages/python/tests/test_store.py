"""Tests for agentos.store clients."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentos.store import (
    cache_store,
    db_store,
    resolve_cache_store_api_base,
    resolve_db_store_api_base,
)


def test_resolve_db_store_api_base() -> None:
    assert resolve_db_store_api_base({}) == "http://127.0.0.1:5173/api/ext/db-store"
    assert (
        resolve_db_store_api_base({"AGENT_OS_DB_STORE_API_BASE": "http://db/"})
        == "http://db"
    )


def test_resolve_cache_store_api_base() -> None:
    assert (
        resolve_cache_store_api_base({})
        == "http://127.0.0.1:5173/api/ext/cache-store"
    )


@pytest.mark.asyncio
@respx.mock
async def test_collection_query_insert(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_DB_STORE_API_BASE", "http://db.test")
    respx.post("http://db.test/collections/invoices/query").mock(
        return_value=httpx.Response(
            200,
            json={
                "items": [
                    {
                        "id": "1",
                        "data": {"n": 1},
                        "createdAt": "t",
                        "updatedAt": "t",
                    },
                ],
            },
        ),
    )
    respx.post("http://db.test/collections/invoices/insert").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "2",
                "data": {"n": 2},
                "createdAt": "t",
                "updatedAt": "t",
            },
        ),
    )
    col = db_store.collection("invoices")
    q = await col.query({"limit": 10})
    assert len(q.items) == 1
    assert q.items[0].id == "1"
    row = await col.insert({"data": {"n": 2}})
    assert row.id == "2"


@pytest.mark.asyncio
@respx.mock
async def test_collection_sends_org_id_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_OS_DB_STORE_API_BASE", "http://db.test")
    route = respx.post("http://db.test/collections/invoices/query").mock(
        return_value=httpx.Response(200, json={"items": []}),
    )
    col = db_store.collection("invoices", org_id="org_demo")
    await col.query({"limit": 10})
    assert route.called
    assert route.calls[0].request.headers.get("x-agentos-org-id") == "org_demo"


@pytest.mark.asyncio
@respx.mock
async def test_collection_insert_bulk_retention(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_OS_DB_STORE_API_BASE", "http://db.test")
    respx.post("http://db.test/collections/invoices/insert-bulk").mock(
        return_value=httpx.Response(
            201,
            json={
                "items": [
                    {
                        "id": "1",
                        "data": {"n": 1},
                        "createdAt": "t",
                        "updatedAt": "t",
                    },
                ],
            },
        ),
    )
    respx.post("http://db.test/collections/invoices/retention").mock(
        return_value=httpx.Response(
            201,
            json={
                "policy": {
                    "orgId": "org-1",
                    "collection": "invoices",
                    "maxCount": 5,
                },
            },
        ),
    )
    respx.post("http://db.test/collections/invoices/prune").mock(
        return_value=httpx.Response(200, json={"deleted": 1}),
    )
    col = db_store.collection("invoices")
    bulk = await col.insert_bulk({"docs": [{"data": {"n": 1}}]})
    assert len(bulk.items) == 1
    await col.set_retention({"maxCount": 5})
    pruned = await col.prune()
    assert pruned.deleted == 1


@pytest.mark.asyncio
@respx.mock
async def test_cache_get_set_del(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_CACHE_STORE_API_BASE", "http://cache.test")
    respx.post("http://cache.test/get").mock(
        side_effect=[
            httpx.Response(404),
            httpx.Response(200, json={"value": "v"}),
        ],
    )
    respx.post("http://cache.test/set").mock(
        return_value=httpx.Response(200, json={"ok": True}),
    )
    respx.post("http://cache.test/del").mock(
        return_value=httpx.Response(200, json={"deleted": 1}),
    )

    assert await cache_store.get("k") is None
    await cache_store.set("k", "v", ttl=60)
    assert await cache_store.get("k") == "v"
    result = await cache_store.delete("k")
    assert result.deleted == 1

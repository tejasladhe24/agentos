"""agentos.store — db + cache HTTP clients for services (ticket 24).

Talks only to builtins via `/api/ext/db-store` and `/api/ext/cache-store`.
No SQL, Redis, or DATABASE_URL in this kit (ADR 004).
"""

from __future__ import annotations

import os
from typing import Any
from urllib.parse import quote

import httpx
from pydantic import BaseModel, Field

from agentos.http import EnvMap, post_json, resolve_gateway_url


class DocumentRow(BaseModel):
    id: str
    data: dict[str, Any]
    createdAt: str
    updatedAt: str


class QueryInput(BaseModel):
    where: dict[str, Any] | None = None
    # { field: "asc" | "desc" } — key order is sort priority
    sort: dict[str, str] | None = None
    limit: int | None = None
    offset: int | None = None


class InsertInput(BaseModel):
    data: dict[str, Any]
    id: str | None = None


class UpdateInput(BaseModel):
    id: str
    data: dict[str, Any]
    merge: bool | None = None


class DeleteInput(BaseModel):
    id: str | None = None
    ids: list[str] | None = None


class QueryResult(BaseModel):
    items: list[DocumentRow] = Field(default_factory=list)


class DeleteResult(BaseModel):
    deleted: int


class CacheDelResult(BaseModel):
    deleted: int


def resolve_db_store_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin db-store API base."""
    source = env if env is not None else os.environ
    override = source.get("AGENT_OS_DB_STORE_API_BASE")
    if override:
        return override.rstrip("/")
    return f"{resolve_gateway_url(source)}/api/ext/db-store"


def resolve_cache_store_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin cache-store API base."""
    source = env if env is not None else os.environ
    override = source.get("AGENT_OS_CACHE_STORE_API_BASE")
    if override:
        return override.rstrip("/")
    return f"{resolve_gateway_url(source)}/api/ext/cache-store"


class CollectionClient:
    def __init__(self, name: str) -> None:
        self._encoded = quote(name, safe="")

    async def query(
        self,
        input: QueryInput | dict[str, Any] | None = None,
        *,
        env: EnvMap | None = None,
    ) -> QueryResult:
        base = resolve_db_store_api_base(env)
        body = (
            input.model_dump(exclude_none=True)
            if isinstance(input, QueryInput)
            else (input or {})
        )
        data = await post_json(
            f"{base}/collections/{self._encoded}/query",
            body,
            "db-store query",
        )
        return QueryResult.model_validate(data)

    async def insert(
        self,
        input: InsertInput | dict[str, Any],
        *,
        env: EnvMap | None = None,
    ) -> DocumentRow:
        base = resolve_db_store_api_base(env)
        body = (
            input.model_dump(exclude_none=True)
            if isinstance(input, InsertInput)
            else input
        )
        data = await post_json(
            f"{base}/collections/{self._encoded}/insert",
            body,
            "db-store insert",
        )
        return DocumentRow.model_validate(data)

    async def update(
        self,
        input: UpdateInput | dict[str, Any],
        *,
        env: EnvMap | None = None,
    ) -> DocumentRow:
        base = resolve_db_store_api_base(env)
        body = (
            input.model_dump(exclude_none=True)
            if isinstance(input, UpdateInput)
            else input
        )
        data = await post_json(
            f"{base}/collections/{self._encoded}/update",
            body,
            "db-store update",
        )
        return DocumentRow.model_validate(data)

    async def delete(
        self,
        input: DeleteInput | dict[str, Any] | None = None,
        *,
        env: EnvMap | None = None,
    ) -> DeleteResult:
        base = resolve_db_store_api_base(env)
        body = (
            input.model_dump(exclude_none=True)
            if isinstance(input, DeleteInput)
            else (input or {})
        )
        data = await post_json(
            f"{base}/collections/{self._encoded}/delete",
            body,
            "db-store delete",
        )
        return DeleteResult.model_validate(data)


class _DbStore:
    def collection(self, name: str) -> CollectionClient:
        return CollectionClient(name)


class _CacheStore:
    async def get(
        self,
        key: str,
        *,
        env: EnvMap | None = None,
    ) -> Any | None:
        base = resolve_cache_store_api_base(env)
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{base}/get",
                headers={"content-type": "application/json"},
                json={"key": key},
            )
        if res.status_code == 404:
            return None
        if not res.is_success:
            detail = res.text
            raise RuntimeError(
                f"cache-store get failed ({res.status_code}): "
                f"{detail or res.reason_phrase}",
            )
        body = res.json()
        if isinstance(body, dict):
            return body.get("value")
        return None

    async def set(
        self,
        key: str,
        value: Any,
        ttl: int | None = None,
        *,
        env: EnvMap | None = None,
    ) -> None:
        base = resolve_cache_store_api_base(env)
        body: dict[str, Any] = {"key": key, "value": value}
        if ttl is not None:
            body["ttl"] = ttl
        await post_json(f"{base}/set", body, "cache-store set")

    async def delete(
        self,
        key: str | list[str],
        *,
        env: EnvMap | None = None,
    ) -> CacheDelResult:
        """Delete cache key(s). Named `delete` (Python reserved `del`)."""
        base = resolve_cache_store_api_base(env)
        body = {"keys": key} if isinstance(key, list) else {"key": key}
        data = await post_json(f"{base}/del", body, "cache-store del")
        return CacheDelResult.model_validate(data)

    # Alias matching TS `cacheStore.del`
    async def del_(
        self,
        key: str | list[str],
        *,
        env: EnvMap | None = None,
    ) -> CacheDelResult:
        return await self.delete(key, env=env)


db_store = _DbStore()
cache_store = _CacheStore()

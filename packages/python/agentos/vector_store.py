"""agentos.vector_store — HTTP client for builtin `vector-store` (ticket 79).

Storage/search only; generate embeddings via `agentos.ai.embed`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

from pydantic import BaseModel, Field

from agentos.http import EnvMap, get_json, post_json, resolve_ext_api_base

ORG_ID_HEADER = "x-agentos-org-id"


def resolve_vector_store_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin vector-store API base."""
    return resolve_ext_api_base(
        "vector-store",
        "AGENT_OS_VECTOR_STORE_API_BASE",
        env,
    )


class VectorItem(BaseModel):
    id: str
    embedding: list[float]
    content: str | None = None
    metadata: dict[str, Any] | None = None


class UpsertInput(BaseModel):
    items: list[VectorItem]


class UpsertResult(BaseModel):
    upserted: int


class QueryInput(BaseModel):
    embedding: list[float]
    topK: int | None = None
    filter: dict[str, Any] | None = None


class QueryHit(BaseModel):
    id: str
    score: float
    content: str | None = None
    metadata: dict[str, Any] | None = None


class QueryResult(BaseModel):
    items: list[QueryHit] = Field(default_factory=list)


class DeleteInput(BaseModel):
    id: str | None = None
    ids: list[str] | None = None


class DeleteResult(BaseModel):
    deleted: int


class VectorStoreStats(BaseModel):
    vectors: int


class VectorStoreHealth(BaseModel):
    ok: bool
    mode: str
    dimensions: int


def _headers(org_id: str | None = None) -> dict[str, str] | None:
    if not org_id:
        return None
    return {ORG_ID_HEADER: org_id}


def _body(model: BaseModel | dict[str, Any]) -> dict[str, Any]:
    if isinstance(model, BaseModel):
        return model.model_dump(exclude_none=True)
    return model


def _index_url(base: str, index_name: str, action: str) -> str:
    return f"{base}/indexes/{quote(index_name, safe='')}/{action}"


async def health(env: EnvMap | None = None) -> VectorStoreHealth:
    base = resolve_vector_store_api_base(env)
    data = await get_json(f"{base}/health", "vector-store health")
    return VectorStoreHealth.model_validate(data)


async def upsert(
    index_name: str,
    input: UpsertInput | dict[str, Any],
    *,
    org_id: str | None = None,
    env: EnvMap | None = None,
) -> UpsertResult:
    base = resolve_vector_store_api_base(env)
    data = await post_json(
        _index_url(base, index_name, "upsert"),
        _body(input),
        "vector-store upsert",
        headers=_headers(org_id),
    )
    return UpsertResult.model_validate(data)


async def query(
    index_name: str,
    input: QueryInput | dict[str, Any],
    *,
    org_id: str | None = None,
    env: EnvMap | None = None,
) -> QueryResult:
    base = resolve_vector_store_api_base(env)
    data = await post_json(
        _index_url(base, index_name, "query"),
        _body(input),
        "vector-store query",
        headers=_headers(org_id),
    )
    return QueryResult.model_validate(data)


async def delete(
    index_name: str,
    input: DeleteInput | dict[str, Any],
    *,
    org_id: str | None = None,
    env: EnvMap | None = None,
) -> DeleteResult:
    base = resolve_vector_store_api_base(env)
    data = await post_json(
        _index_url(base, index_name, "delete"),
        _body(input),
        "vector-store delete",
        headers=_headers(org_id),
    )
    return DeleteResult.model_validate(data)


async def stats(
    *,
    org_id: str | None = None,
    env: EnvMap | None = None,
) -> VectorStoreStats:
    """Count the org's stored vectors across every index."""
    base = resolve_vector_store_api_base(env)
    data = await get_json(
        f"{base}/stats", "vector-store stats", headers=_headers(org_id)
    )
    return VectorStoreStats.model_validate(data)

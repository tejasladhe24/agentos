"""agentos.integrations — tenant BYOK integrations kit (ticket 103).

Mirrors `@agentos/core/api/integrations`. Non-secret settings live in the
org-scoped db-store collection `integrations`; secret values live in the
`secrets` vault under `integrations/<integration>/<instance_id>/<field>`.
`None` from `get_integration` means "use the platform env config".
"""

from __future__ import annotations

import copy
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Generic, Literal, Protocol, TypeVar
from urllib.parse import quote

import httpx

from agentos.audit import resolve_audit_api_base
from agentos.events import resolve_events_api_base
from agentos.http import EnvMap
from agentos.secrets import resolve_secrets_api_base
from agentos.store import resolve_db_store_api_base

INTEGRATIONS_COLLECTION = "integrations"
INTEGRATION_SECRET_PREFIX = "integrations/"
INTEGRATION_CHANGED_TOPIC = "integration.changed"
PERMISSION_INTEGRATIONS_MANAGE = "integrations.manage"
DEFAULT_INTEGRATION_INSTANCE = "default"
DEFAULT_INTEGRATION_CACHE_TTL_S = 30.0

_ORG_ID_HEADER = "x-agentos-org-id"
_INTEGRATION_ID = re.compile(r"^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$")
_INSTANCE_ID = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$")
_FIELD = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]{0,63}$")
_PROVIDER = re.compile(r"^[a-z][a-z0-9-]{0,63}$")

T = TypeVar("T")


class IntegrationError(ValueError):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def is_valid_integration_id(value: str) -> bool:
    return bool(_INTEGRATION_ID.match(value)) and len(value) <= 64


def is_valid_instance_id(value: str) -> bool:
    return bool(_INSTANCE_ID.match(value))


def is_valid_integration_field(value: str) -> bool:
    return bool(_FIELD.match(value))


def integration_doc_id(
    integration: str, instance_id: str = DEFAULT_INTEGRATION_INSTANCE
) -> str:
    return f"{integration}:{instance_id}"


def integration_secret_key(integration: str, instance_id: str, field_name: str) -> str:
    return f"{INTEGRATION_SECRET_PREFIX}{integration}/{instance_id}/{field_name}"


def is_integration_secret_key(key: str) -> bool:
    return key.startswith(INTEGRATION_SECRET_PREFIX)


def _assert_ids(integration: str, instance_id: str) -> None:
    if not is_valid_integration_id(integration):
        raise IntegrationError(f"invalid integration id: {integration}")
    if not is_valid_instance_id(instance_id):
        raise IntegrationError(f"invalid instance id: {instance_id}")


def _now_iso(now: float) -> str:
    return (
        datetime.fromtimestamp(now, tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def parse_integration_record(doc_id: str, data: dict[str, Any]) -> dict[str, Any] | None:
    """Normalise a db-store document into a record dict (no secret values)."""
    integration = data.get("integration")
    provider = data.get("provider")
    if not isinstance(integration, str) or not integration:
        return None
    if not isinstance(provider, str) or not provider:
        return None
    settings = data.get("settings")
    updated_at = data.get("updatedAt") if isinstance(data.get("updatedAt"), str) else _now_iso(0)

    def _str_map(value: Any) -> dict[str, str]:
        if not isinstance(value, dict):
            return {}
        return {k: v for k, v in value.items() if isinstance(v, str)}

    record: dict[str, Any] = {
        "id": data.get("id") if isinstance(data.get("id"), str) else doc_id,
        "integration": integration,
        "instanceId": data.get("instanceId")
        if isinstance(data.get("instanceId"), str)
        else DEFAULT_INTEGRATION_INSTANCE,
        "provider": provider,
        "settings": dict(settings) if isinstance(settings, dict) else {},
        "secretRefs": _str_map(data.get("secretRefs")),
        "secretUpdatedAt": _str_map(data.get("secretUpdatedAt")),
        "createdAt": data.get("createdAt") if isinstance(data.get("createdAt"), str) else updated_at,
        "updatedAt": updated_at,
    }
    if isinstance(data.get("updatedBy"), str):
        record["updatedBy"] = data["updatedBy"]
    return record


def to_integration_view(record: dict[str, Any]) -> dict[str, Any]:
    """Display-safe view: secrets become `{ set: True, updatedAt }`."""
    secrets: dict[str, dict[str, Any]] = {}
    for name in record.get("secretRefs", {}):
        status: dict[str, Any] = {"set": True}
        stamp = record.get("secretUpdatedAt", {}).get(name)
        if stamp:
            status["updatedAt"] = stamp
        secrets[name] = status
    view = {
        "id": record["id"],
        "integration": record["integration"],
        "instanceId": record["instanceId"],
        "provider": record["provider"],
        "settings": dict(record.get("settings", {})),
        "secrets": secrets,
        "createdAt": record["createdAt"],
        "updatedAt": record["updatedAt"],
    }
    if record.get("updatedBy"):
        view["updatedBy"] = record["updatedBy"]
    return view


class IntegrationsBackend(Protocol):
    async def get_record(self, org_id: str, doc_id: str) -> dict[str, Any] | None: ...
    async def list_records(
        self, org_id: str, integration: str | None = None
    ) -> list[dict[str, Any]]: ...
    async def put_record(self, org_id: str, record: dict[str, Any]) -> None: ...
    async def delete_record(self, org_id: str, doc_id: str) -> bool: ...
    async def get_secret(self, org_id: str, key: str) -> str | None: ...
    async def put_secret(self, org_id: str, key: str, value: str) -> None: ...
    async def delete_secret(self, org_id: str, key: str) -> None: ...
    async def publish(self, topic: str, payload: dict[str, Any]) -> None: ...
    async def audit(self, org_id: str, entry: dict[str, Any]) -> None: ...


@dataclass
class ResolveProviderResult(Generic[T]):
    source: Literal["tenant", "platform"]
    provider: T
    integration: dict[str, Any] | None = None


@dataclass
class _CacheEntry:
    value: Any
    expires_at: float


@dataclass
class IntegrationsKit:
    """Kit bound to a backend. Keep one per process so the cache is shared."""

    backend: IntegrationsBackend
    ttl_s: float = DEFAULT_INTEGRATION_CACHE_TTL_S
    now: Callable[[], float] = time.time
    _records: dict[str, _CacheEntry] = field(default_factory=dict)
    _providers: dict[str, _CacheEntry] = field(default_factory=dict)

    @staticmethod
    def _key(org_id: str, doc_id: str) -> str:
        return f"{org_id}\x00{doc_id}"

    def invalidate(
        self,
        org_id: str | None = None,
        integration: str | None = None,
        instance_id: str | None = None,
    ) -> None:
        if not org_id:
            self._records.clear()
            self._providers.clear()
            return
        if integration:
            target = integration_doc_id(integration, instance_id) if instance_id else integration
            prefix = self._key(org_id, target)
        else:
            prefix = f"{org_id}\x00"
        for cache in (self._records, self._providers):
            for key in [k for k in cache if k.startswith(prefix)]:
                del cache[key]

    async def _get_record(
        self, org_id: str, integration: str, instance_id: str
    ) -> dict[str, Any] | None:
        _assert_ids(integration, instance_id)
        key = self._key(org_id, integration_doc_id(integration, instance_id))
        cached = self._records.get(key)
        if cached and cached.expires_at > self.now():
            return cached.value
        record = await self.backend.get_record(
            org_id, integration_doc_id(integration, instance_id)
        )
        self._records[key] = _CacheEntry(record, self.now() + self.ttl_s)
        return record

    async def _decrypt(self, org_id: str, record: dict[str, Any]) -> dict[str, Any]:
        secrets: dict[str, str] = {}
        for name, vault_key in record.get("secretRefs", {}).items():
            value = await self.backend.get_secret(org_id, vault_key)
            if value is not None:
                secrets[name] = value
        return {
            "id": record["id"],
            "integration": record["integration"],
            "instanceId": record["instanceId"],
            "provider": record["provider"],
            "settings": dict(record.get("settings", {})),
            "secrets": secrets,
            "updatedAt": record["updatedAt"],
        }

    async def _announce(
        self, org_id: str, integration: str, instance_id: str, action: str, stamp: str
    ) -> None:
        self.invalidate(org_id, integration, instance_id)
        try:
            await self.backend.publish(
                INTEGRATION_CHANGED_TOPIC,
                {
                    "orgId": org_id,
                    "integration": integration,
                    "instanceId": instance_id,
                    "action": action,
                    "updatedAt": stamp,
                },
            )
        except Exception:  # noqa: BLE001 — best-effort; TTL bounds staleness
            pass

    async def _audit(self, org_id: str, entry: dict[str, Any]) -> None:
        try:
            await self.backend.audit(org_id, entry)
        except Exception:  # noqa: BLE001 — never fail the integration op
            pass

    async def get_integration(
        self,
        org_id: str,
        integration: str,
        instance_id: str = DEFAULT_INTEGRATION_INSTANCE,
    ) -> dict[str, Any] | None:
        """Settings + decrypted secrets, or `None` → caller uses platform env."""
        record = await self._get_record(org_id, integration, instance_id)
        return await self._decrypt(org_id, record) if record else None

    async def describe_integration(
        self,
        org_id: str,
        integration: str,
        instance_id: str = DEFAULT_INTEGRATION_INSTANCE,
    ) -> dict[str, Any] | None:
        record = await self._get_record(org_id, integration, instance_id)
        return to_integration_view(record) if record else None

    async def list_integrations(
        self, org_id: str, integration: str | None = None
    ) -> list[dict[str, Any]]:
        if integration and not is_valid_integration_id(integration):
            raise IntegrationError(f"invalid integration id: {integration}")
        records = await self.backend.list_records(org_id, integration)
        return [
            to_integration_view(r)
            for r in records
            if not integration or r["integration"] == integration
        ]

    async def put_integration(
        self,
        org_id: str,
        *,
        integration: str,
        provider: str,
        instance_id: str = DEFAULT_INTEGRATION_INSTANCE,
        settings: dict[str, Any] | None = None,
        secrets: dict[str, str | None] | None = None,
        updated_by: str | None = None,
    ) -> dict[str, Any]:
        """Write the record + vault secrets. `None` removes a secret field."""
        _assert_ids(integration, instance_id)
        provider = provider.strip() if isinstance(provider, str) else ""
        if not _PROVIDER.match(provider):
            raise IntegrationError("valid provider required")
        settings = dict(settings or {})
        for key in settings:
            if not is_valid_integration_field(key):
                raise IntegrationError(f"invalid settings field: {key}")
        secret_input = dict(secrets or {})
        for name, value in secret_input.items():
            if not is_valid_integration_field(name):
                raise IntegrationError(f"invalid secret field: {name}")
            if value is not None and (not isinstance(value, str) or not value):
                raise IntegrationError(f"secret {name} must be a string")

        doc_id = integration_doc_id(integration, instance_id)
        existing = await self.backend.get_record(org_id, doc_id)
        stamp = _now_iso(self.now())
        provider_changed = bool(existing and existing["provider"] != provider)

        refs: dict[str, str] = {}
        stamps: dict[str, str] = {}
        removed: list[str] = []
        if existing:
            for name, vault_key in existing["secretRefs"].items():
                missing = name not in secret_input
                if (name in secret_input and secret_input[name] is None) or (
                    provider_changed and missing
                ):
                    removed.append(name)
                    await self.backend.delete_secret(org_id, vault_key)
                    continue
                refs[name] = vault_key
                if existing["secretUpdatedAt"].get(name):
                    stamps[name] = existing["secretUpdatedAt"][name]
        written: list[str] = []
        for name, value in secret_input.items():
            if value is None:
                continue
            vault_key = integration_secret_key(integration, instance_id, name)
            await self.backend.put_secret(org_id, vault_key, value)
            refs[name] = vault_key
            stamps[name] = stamp
            written.append(name)

        record: dict[str, Any] = {
            "id": doc_id,
            "integration": integration,
            "instanceId": instance_id,
            "provider": provider,
            "settings": settings,
            "secretRefs": refs,
            "secretUpdatedAt": stamps,
            "createdAt": existing["createdAt"] if existing else stamp,
            "updatedAt": stamp,
        }
        if updated_by:
            record["updatedBy"] = updated_by
        await self.backend.put_record(org_id, record)
        await self._announce(org_id, integration, instance_id, "put", stamp)
        entry: dict[str, Any] = {
            "action": "integration.put",
            "resource": doc_id,
            "meta": {
                "integration": integration,
                "instanceId": instance_id,
                "provider": provider,
                "settingsFields": list(settings),
                "secretFieldsWritten": written,
                "secretFieldsRemoved": removed,
            },
        }
        if updated_by:
            entry["actor"] = updated_by
        await self._audit(org_id, entry)
        return to_integration_view(record)

    async def delete_integration(
        self,
        org_id: str,
        integration: str,
        instance_id: str = DEFAULT_INTEGRATION_INSTANCE,
        actor: str | None = None,
    ) -> dict[str, bool]:
        _assert_ids(integration, instance_id)
        doc_id = integration_doc_id(integration, instance_id)
        existing = await self.backend.get_record(org_id, doc_id)
        if not existing:
            self.invalidate(org_id, integration, instance_id)
            return {"deleted": False}
        for vault_key in existing["secretRefs"].values():
            await self.backend.delete_secret(org_id, vault_key)
        deleted = await self.backend.delete_record(org_id, doc_id)
        stamp = _now_iso(self.now())
        await self._announce(org_id, integration, instance_id, "delete", stamp)
        entry: dict[str, Any] = {
            "action": "integration.delete",
            "resource": doc_id,
            "meta": {
                "integration": integration,
                "instanceId": instance_id,
                "provider": existing["provider"],
                "secretFieldsRemoved": list(existing["secretRefs"]),
            },
        }
        if actor:
            entry["actor"] = actor
        await self._audit(org_id, entry)
        return {"deleted": deleted}

    async def record_integration_test(
        self,
        org_id: str,
        *,
        integration: str,
        provider: str,
        ok: bool,
        source: Literal["tenant", "platform", "draft"],
        instance_id: str = DEFAULT_INTEGRATION_INSTANCE,
        actor: str | None = None,
    ) -> None:
        entry: dict[str, Any] = {
            "action": "integration.test",
            "resource": integration_doc_id(integration, instance_id),
            "meta": {
                "integration": integration,
                "instanceId": instance_id,
                "provider": provider,
                "ok": ok,
                "source": source,
            },
        }
        if actor:
            entry["actor"] = actor
        await self._audit(org_id, entry)

    async def resolve_provider(
        self,
        org_id: str | None,
        integration: str,
        build_from_config: Callable[[dict[str, Any]], T | Awaitable[T]],
        build_from_env: Callable[[], T | Awaitable[T]],
        *,
        instance_id: str = DEFAULT_INTEGRATION_INSTANCE,
    ) -> ResolveProviderResult[T]:
        """Tenant config wins; else platform env. Cached by org+integration+instance+updatedAt."""

        async def _call(fn: Callable[..., Any], *args: Any) -> Any:
            out = fn(*args)
            if hasattr(out, "__await__"):
                return await out
            return out

        record = await self._get_record(org_id, integration, instance_id) if org_id else None
        if not org_id or not record:
            return ResolveProviderResult("platform", await _call(build_from_env))
        key = f"{self._key(org_id, record['id'])}\x00{record['updatedAt']}"
        cached = self._providers.get(key)
        if cached and cached.expires_at > self.now():
            provider, config = cached.value
            return ResolveProviderResult("tenant", provider, config)
        config = await self._decrypt(org_id, record)
        provider = await _call(build_from_config, config)
        self._providers[key] = _CacheEntry((provider, config), self.now() + self.ttl_s)
        return ResolveProviderResult("tenant", provider, config)

    def handle_changed_event(self, payload: Any) -> None:
        """Apply an `integration.changed` event from another replica."""
        if not isinstance(payload, dict):
            return
        org_id = payload.get("orgId")
        if not isinstance(org_id, str) or not org_id:
            return
        integration = payload.get("integration")
        instance_id = payload.get("instanceId")
        self.invalidate(
            org_id,
            integration if isinstance(integration, str) else None,
            instance_id if isinstance(instance_id, str) else None,
        )


class HttpIntegrationsBackend:
    """Backend over builtins db-store, secrets, events, and audit."""

    def __init__(
        self,
        env: EnvMap | None = None,
        *,
        db_store_api_base: str | None = None,
        secrets_api_base: str | None = None,
        events_api_base: str | None = None,
        audit_api_base: str | None = None,
        publish_events: bool = True,
        write_audit: bool = True,
    ) -> None:
        self._db = (db_store_api_base or resolve_db_store_api_base(env)).rstrip("/")
        self._secrets = (secrets_api_base or resolve_secrets_api_base(env)).rstrip("/")
        self._events = (events_api_base or resolve_events_api_base(env)).rstrip("/")
        self._audit = (audit_api_base or resolve_audit_api_base(env)).rstrip("/")
        self._publish_events = publish_events
        self._write_audit = write_audit
        self._collection = f"{self._db}/collections/{INTEGRATIONS_COLLECTION}"

    @staticmethod
    def _headers(org_id: str) -> dict[str, str]:
        return {"content-type": "application/json", _ORG_ID_HEADER: org_id}

    @staticmethod
    def _raise(res: httpx.Response, label: str) -> None:
        if not res.is_success:
            raise RuntimeError(
                f"{label} failed ({res.status_code}): {res.text or res.reason_phrase}"
            )

    async def _query(self, org_id: str, body: dict[str, Any]) -> list[dict[str, Any]]:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self._collection}/query", json=body, headers=self._headers(org_id)
            )
        self._raise(res, "db-store query")
        out: list[dict[str, Any]] = []
        for doc in res.json().get("items", []):
            record = parse_integration_record(doc.get("id", ""), doc.get("data") or {})
            if record:
                out.append(record)
        return out

    async def get_record(self, org_id: str, doc_id: str) -> dict[str, Any] | None:
        items = await self._query(org_id, {"where": {"id": doc_id}, "limit": 1})
        return items[0] if items else None

    async def list_records(
        self, org_id: str, integration: str | None = None
    ) -> list[dict[str, Any]]:
        body: dict[str, Any] = {"sort": {"createdAt": "asc"}, "limit": 500}
        if integration:
            body["where"] = {"integration": integration}
        return await self._query(org_id, body)

    async def put_record(self, org_id: str, record: dict[str, Any]) -> None:
        existing = await self.get_record(org_id, record["id"])
        op = "update" if existing else "insert"
        body: dict[str, Any] = {"id": record["id"], "data": record}
        if existing:
            body["merge"] = False
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self._collection}/{op}", json=body, headers=self._headers(org_id)
            )
        self._raise(res, f"db-store {op}")

    async def delete_record(self, org_id: str, doc_id: str) -> bool:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self._collection}/delete",
                json={"id": doc_id},
                headers=self._headers(org_id),
            )
        self._raise(res, "db-store delete")
        return int(res.json().get("deleted", 0)) > 0

    def _secret_url(self, key: str) -> str:
        return f"{self._secrets}/secrets/{quote(key, safe='')}"

    async def get_secret(self, org_id: str, key: str) -> str | None:
        async with httpx.AsyncClient() as client:
            res = await client.get(self._secret_url(key), headers=self._headers(org_id))
        if res.status_code == 404:
            return None
        self._raise(res, "secrets get")
        body = res.json()
        if body.get("source") != "vault" or not isinstance(body.get("value"), str):
            return None
        return body["value"]

    async def put_secret(self, org_id: str, key: str, value: str) -> None:
        async with httpx.AsyncClient() as client:
            res = await client.put(
                self._secret_url(key), json={"value": value}, headers=self._headers(org_id)
            )
        self._raise(res, "secrets put")

    async def delete_secret(self, org_id: str, key: str) -> None:
        async with httpx.AsyncClient() as client:
            res = await client.delete(self._secret_url(key), headers=self._headers(org_id))
        if res.status_code == 404:
            return
        self._raise(res, "secrets delete")

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        if not self._publish_events:
            return
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self._events}/publish", json={"topic": topic, "payload": payload}
            )
        self._raise(res, "events publish")

    async def audit(self, org_id: str, entry: dict[str, Any]) -> None:
        if not self._write_audit:
            return
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{self._audit}/entries", json=entry, headers=self._headers(org_id)
            )
        self._raise(res, "audit append")


class MemoryIntegrationsBackend:
    """In-memory backend for tests / local demos."""

    def __init__(self) -> None:
        self.records: dict[str, dict[str, Any]] = {}
        self.vault: dict[str, str] = {}
        self.events: list[dict[str, Any]] = []
        self.audit_log: list[dict[str, Any]] = []

    @staticmethod
    def _k(org_id: str, key: str) -> str:
        return f"{org_id}\x00{key}"

    async def get_record(self, org_id: str, doc_id: str) -> dict[str, Any] | None:
        record = self.records.get(self._k(org_id, doc_id))
        return _deep_copy(record) if record else None

    async def list_records(
        self, org_id: str, integration: str | None = None
    ) -> list[dict[str, Any]]:
        prefix = f"{org_id}\x00"
        return [
            _deep_copy(r)
            for k, r in self.records.items()
            if k.startswith(prefix) and (not integration or r["integration"] == integration)
        ]

    async def put_record(self, org_id: str, record: dict[str, Any]) -> None:
        self.records[self._k(org_id, record["id"])] = _deep_copy(record)

    async def delete_record(self, org_id: str, doc_id: str) -> bool:
        return self.records.pop(self._k(org_id, doc_id), None) is not None

    async def get_secret(self, org_id: str, key: str) -> str | None:
        return self.vault.get(self._k(org_id, key))

    async def put_secret(self, org_id: str, key: str, value: str) -> None:
        self.vault[self._k(org_id, key)] = value

    async def delete_secret(self, org_id: str, key: str) -> None:
        self.vault.pop(self._k(org_id, key), None)

    async def publish(self, topic: str, payload: dict[str, Any]) -> None:
        self.events.append({"topic": topic, "payload": payload})

    async def audit(self, org_id: str, entry: dict[str, Any]) -> None:
        self.audit_log.append({"orgId": org_id, **entry})


def _deep_copy(value: dict[str, Any]) -> dict[str, Any]:
    return copy.deepcopy(value)


def create_integrations_kit(
    backend: IntegrationsBackend | None = None,
    *,
    env: EnvMap | None = None,
    ttl_s: float = DEFAULT_INTEGRATION_CACHE_TTL_S,
) -> IntegrationsKit:
    """Kit over the given backend (default: HTTP to builtins via gateway/env)."""
    return IntegrationsKit(backend or HttpIntegrationsBackend(env), ttl_s=ttl_s)

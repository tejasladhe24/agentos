"""Tests for agentos.auth FastAPI Depends."""

from __future__ import annotations

import httpx
import pytest
import respx
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from agentos.auth import (
    AuthSession,
    require_org,
    require_permissions,
    require_roles,
    require_session,
    resolve_auth_api_base,
)

SESSION = {
    "user": {"id": "u1", "email": "a@b.c", "name": "A"},
    "session": {"id": "s1", "expiresAt": "2099-01-01T00:00:00Z"},
    "roles": ["admin"],
    "orgId": "org_1",
    "orgs": [{"id": "org_1", "name": "Acme", "role": "admin"}],
}


def test_resolve_auth_api_base_default() -> None:
    assert resolve_auth_api_base({}) == "http://127.0.0.1:5173/api/ext/auth"


def test_resolve_auth_api_base_override() -> None:
    assert (
        resolve_auth_api_base({"AGENT_OS_AUTH_API_BASE": "http://auth/"})
        == "http://auth"
    )


def _app_with_session() -> FastAPI:
    app = FastAPI()

    @app.get("/me")
    async def me(session: AuthSession = Depends(require_session())) -> dict:
        return {"userId": session.user.id}

    return app


@pytest.mark.asyncio
@respx.mock
async def test_require_session_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(200, json=SESSION),
    )
    client = TestClient(_app_with_session())
    res = client.get("/me", headers={"cookie": "sid=1"})
    assert res.status_code == 200
    assert res.json() == {"userId": "u1"}
    assert respx.calls[0].request.headers.get("cookie") == "sid=1"


@pytest.mark.asyncio
@respx.mock
async def test_require_session_401(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(401, json={"error": "unauthenticated"}),
    )
    client = TestClient(_app_with_session())
    res = client.get("/me")
    assert res.status_code == 401


def _app_with_roles() -> FastAPI:
    app = FastAPI()

    @app.get("/admin")
    async def admin(
        session: AuthSession = Depends(require_roles("admin")),
    ) -> dict:
        return {"ok": True, "roles": session.roles}

    return app


@pytest.mark.asyncio
@respx.mock
async def test_require_roles_forbidden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    session = {**SESSION, "roles": ["viewer"]}
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(200, json=session),
    )
    client = TestClient(_app_with_roles())
    res = client.get("/admin", headers={"cookie": "sid=1"})
    assert res.status_code == 403


def _app_with_perms() -> FastAPI:
    app = FastAPI()

    @app.get("/crm")
    async def crm(
        session: AuthSession = Depends(require_permissions("crm.read")),
    ) -> dict:
        return {"ok": True, "user": session.user.id}

    return app


@pytest.mark.asyncio
@respx.mock
async def test_require_permissions_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(200, json=SESSION),
    )
    respx.post("http://auth.test/permissions/check").mock(
        return_value=httpx.Response(200, json={"allowed": True}),
    )
    client = TestClient(_app_with_perms())
    res = client.get("/crm", headers={"cookie": "sid=1"})
    assert res.status_code == 200
    assert res.json() == {"ok": True, "user": "u1"}


@pytest.mark.asyncio
@respx.mock
async def test_require_permissions_denied(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(200, json=SESSION),
    )
    respx.post("http://auth.test/permissions/check").mock(
        return_value=httpx.Response(200, json={"allowed": False}),
    )
    client = TestClient(_app_with_perms())
    res = client.get("/crm", headers={"cookie": "sid=1"})
    assert res.status_code == 403


def _app_with_org() -> FastAPI:
    app = FastAPI()

    @app.get("/tenant")
    async def tenant(session: AuthSession = Depends(require_org())) -> dict:
        return {"orgId": session.orgId}

    return app


@pytest.mark.asyncio
@respx.mock
async def test_require_org_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(200, json=SESSION),
    )
    client = TestClient(_app_with_org())
    res = client.get("/tenant", headers={"cookie": "sid=1"})
    assert res.status_code == 200
    assert res.json() == {"orgId": "org_1"}


@pytest.mark.asyncio
@respx.mock
async def test_require_org_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_AUTH_API_BASE", "http://auth.test")
    session = {**SESSION, "orgId": None, "orgs": []}
    respx.get("http://auth.test/session").mock(
        return_value=httpx.Response(200, json=session),
    )
    client = TestClient(_app_with_org())
    res = client.get("/tenant", headers={"cookie": "sid=1"})
    assert res.status_code == 400
    assert res.json()["detail"]["error"] == "organization required"

"""agentos.auth — session + RBAC FastAPI Depends (ticket 24).

HTTP client against gateway `/api/ext/auth/*` (no local Better Auth).
"""

from __future__ import annotations

import os
from typing import Annotated, Any, Callable

import httpx
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel, Field

from agentos.http import EnvMap, resolve_gateway_url

SESSION_KEY = "auth.session"


class AuthUser(BaseModel):
    id: str
    email: str
    name: str


class AuthSessionInfo(BaseModel):
    id: str
    expiresAt: str | Any


class AuthOrgMembership(BaseModel):
    id: str
    name: str
    role: str


class AuthSession(BaseModel):
    user: AuthUser
    session: AuthSessionInfo
    roles: list[str] = Field(default_factory=list)
    # Active organization id, or null when the user has no memberships.
    orgId: str | None = None
    orgs: list[AuthOrgMembership] = Field(default_factory=list)


def resolve_auth_api_base(env: EnvMap | None = None) -> str:
    """Resolve builtin auth API base (`…/api/ext/auth` or test override)."""
    source = env if env is not None else os.environ
    override = source.get("AGENT_OS_AUTH_API_BASE")
    if override:
        return override.rstrip("/")
    return f"{resolve_gateway_url(source)}/api/ext/auth"


def _forward_cookie_headers(request: Request) -> dict[str, str]:
    headers: dict[str, str] = {}
    cookie = request.headers.get("cookie")
    if cookie:
        headers["cookie"] = cookie
    return headers


async def _fetch_session(
    request: Request,
    base: str,
) -> AuthSession | None:
    headers = _forward_cookie_headers(request)
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(f"{base}/session", headers=headers)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": f"auth unreachable: {exc}"},
        ) from exc
    if res.status_code == 401 or not res.is_success:
        return None
    try:
        body = res.json()
    except Exception:
        return None
    if not isinstance(body, dict) or not body.get("user", {}).get("id"):
        return None
    return AuthSession.model_validate(body)


async def _check_permission(
    request: Request,
    base: str,
    permission: str,
) -> str:
    headers = _forward_cookie_headers(request)
    headers["content-type"] = "application/json"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.post(
                f"{base}/permissions/check",
                headers=headers,
                json={"permission": permission},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=503,
            detail={"error": f"auth unreachable: {exc}"},
        ) from exc
    if res.status_code == 401:
        return "unauthenticated"
    if not res.is_success:
        return "denied"
    body = res.json()
    if isinstance(body, dict) and body.get("allowed") is True:
        return "allowed"
    return "denied"


async def _ensure_session(request: Request, base: str) -> AuthSession:
    existing = getattr(request.state, SESSION_KEY, None)
    if isinstance(existing, AuthSession):
        return existing
    session = await _fetch_session(request, base)
    if session is None:
        raise HTTPException(status_code=401, detail={"error": "unauthenticated"})
    setattr(request.state, SESSION_KEY, session)
    return session


def get_session(request: Request) -> AuthSession | None:
    """Read session stashed by auth Depends (if any)."""
    existing = getattr(request.state, SESSION_KEY, None)
    return existing if isinstance(existing, AuthSession) else None


def require_session() -> Callable[..., Any]:
    """FastAPI Depends: require authenticated session (401 if missing)."""

    async def _dep(request: Request) -> AuthSession:
        base = resolve_auth_api_base()
        return await _ensure_session(request, base)

    return _dep


def require_roles(*roles: str) -> Callable[..., Any]:
    """FastAPI Depends: require every listed role (401/403)."""

    async def _dep(request: Request) -> AuthSession:
        base = resolve_auth_api_base()
        session = await _ensure_session(request, base)
        have = set(session.roles)
        for role in roles:
            if role not in have:
                raise HTTPException(status_code=403, detail={"error": "forbidden"})
        return session

    return _dep


def require_permissions(*permissions: str) -> Callable[..., Any]:
    """FastAPI Depends: require every listed permission via builtin check."""

    async def _dep(request: Request) -> AuthSession:
        base = resolve_auth_api_base()
        session = await _ensure_session(request, base)
        for permission in permissions:
            result = await _check_permission(request, base, permission)
            if result == "unauthenticated":
                raise HTTPException(
                    status_code=401,
                    detail={"error": "unauthenticated"},
                )
            if result == "denied":
                raise HTTPException(status_code=403, detail={"error": "forbidden"})
        return session

    return _dep


def require_org() -> Callable[..., Any]:
    """FastAPI Depends: require authenticated session with a non-null active orgId."""

    async def _dep(request: Request) -> AuthSession:
        base = resolve_auth_api_base()
        session = await _ensure_session(request, base)
        if not session.orgId:
            raise HTTPException(
                status_code=400,
                detail={"error": "organization required"},
            )
        return session

    return _dep


# Convenience annotated aliases for route signatures
SessionDep = Annotated[AuthSession, Depends(require_session())]

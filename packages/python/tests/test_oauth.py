"""Tests for agentos.oauth helpers."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentos.oauth import (
    build_authorize_url,
    create_pkce_pair,
    exchange_authorization_code,
    persist_oauth_tokens,
)


def test_build_authorize_url_and_pkce() -> None:
    verifier, challenge = create_pkce_pair()
    assert len(verifier) > 20
    assert len(challenge) > 20
    url = build_authorize_url(
        authorize_url="https://provider.example/oauth/authorize",
        client_id="cid",
        redirect_uri="https://app.example/callback",
        state="st",
        scope=["openid", "profile"],
        code_challenge=challenge,
        extra_params={"audience": "api"},
    )
    assert "client_id=cid" in url
    assert "scope=openid+profile" in url or "scope=openid%20profile" in url
    assert f"code_challenge={challenge}" in url
    assert "audience=api" in url


@pytest.mark.asyncio
@respx.mock
async def test_exchange_authorization_code() -> None:
    respx.post("https://provider.example/oauth/token").mock(
        return_value=httpx.Response(
            200,
            json={"access_token": "a", "refresh_token": "r", "expires_in": 60},
        )
    )
    tokens = await exchange_authorization_code(
        token_url="https://provider.example/oauth/token",
        code="code",
        client_id="cid",
        redirect_uri="https://app.example/callback",
        code_verifier="v",
    )
    assert tokens["access_token"] == "a"


@pytest.mark.asyncio
@respx.mock
async def test_persist_oauth_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGENT_OS_SECRETS_API_BASE", "http://secrets.test")
    route = respx.put("http://secrets.test/secrets/integrations%2Fqbo").mock(
        return_value=httpx.Response(
            200,
            json={"key": "integrations/qbo", "rotatedAt": "t", "version": 1},
        )
    )
    meta = await persist_oauth_tokens(
        org_id="org_1",
        key="integrations/qbo",
        tokens={"accessToken": "a", "refreshToken": "r"},
    )
    assert meta["version"] == 1
    assert route.called
    req = route.calls.last.request
    assert req.headers["x-agentos-org-id"] == "org_1"

"""agentos.oauth — provider-agnostic OAuth URL helpers for Python services (ticket 78).

Builds authorize URLs and exchanges authorization codes over HTTP. Persist tokens
via the secrets builtin (`PUT /api/ext/secrets/secrets/:key` with
`X-AgentOS-Org-Id`), not env or db-store documents.

State signing stays on the Bun API kit when the connect UI lives in an extension;
services that own the full flow can mint their own CSRF state (e.g. cache_store).
"""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
from typing import Any, Literal, Mapping
from urllib.parse import quote, urlencode

import httpx

from agentos.http import EnvMap
from agentos.secrets import (
    SECRETS_ORG_ID_HEADER,
    SECRETS_USER_ID_HEADER,
    resolve_secrets_api_base,
)


def create_pkce_pair() -> tuple[str, str]:
    """Return `(verifier, S256 challenge)` for PKCE."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii").rstrip("=")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return verifier, challenge


def build_authorize_url(
    *,
    authorize_url: str,
    client_id: str,
    redirect_uri: str,
    state: str,
    scope: str | list[str] | None = None,
    code_challenge: str | None = None,
    code_challenge_method: str = "S256",
    extra_params: Mapping[str, str] | None = None,
) -> str:
    """Build a provider authorize URL (query-encoded)."""
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    if scope is not None:
        params["scope"] = " ".join(scope) if isinstance(scope, list) else scope
    if code_challenge:
        params["code_challenge"] = code_challenge
        params["code_challenge_method"] = code_challenge_method
    if extra_params:
        params.update(dict(extra_params))
    sep = "&" if "?" in authorize_url else "?"
    return f"{authorize_url}{sep}{urlencode(params)}"


async def exchange_authorization_code(
    *,
    token_url: str,
    code: str,
    client_id: str,
    redirect_uri: str,
    client_secret: str | None = None,
    code_verifier: str | None = None,
    extra_body: Mapping[str, str] | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Exchange an authorization code (`application/x-www-form-urlencoded`)."""
    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client_id,
        "redirect_uri": redirect_uri,
    }
    if client_secret:
        data["client_secret"] = client_secret
    if code_verifier:
        data["code_verifier"] = code_verifier
    if extra_body:
        data.update(dict(extra_body))

    async def _do(c: httpx.AsyncClient) -> httpx.Response:
        return await c.post(
            token_url,
            data=data,
            headers={"content-type": "application/x-www-form-urlencoded"},
        )

    if client is not None:
        res = await _do(client)
    else:
        async with httpx.AsyncClient() as owned:
            res = await _do(owned)

    if res.status_code >= 400:
        raise RuntimeError(
            f"oauth exchange_authorization_code failed ({res.status_code}): {res.text}"
        )
    body = res.json()
    if not isinstance(body, dict) or not isinstance(body.get("access_token"), str):
        raise RuntimeError("oauth exchange_authorization_code: missing access_token")
    return body


async def persist_oauth_tokens(
    *,
    org_id: str,
    key: str,
    tokens: Mapping[str, Any],
    expires_at: str | None = None,
    scope: Literal["org", "user"] = "org",
    user_id: str | None = None,
    env: EnvMap | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """PUT encrypted tokens to the secrets vault (ticket 77).

    `scope="user"` stores personal tokens readable only by `user_id` (ticket 104).
    """
    if scope == "user" and not user_id:
        raise ValueError('persist_oauth_tokens: user_id required when scope is "user"')
    base = resolve_secrets_api_base(env)
    url = f"{base}/secrets/{quote(key, safe='')}"
    headers = {
        "content-type": "application/json",
        SECRETS_ORG_ID_HEADER: org_id,
    }
    if scope == "user" and user_id:
        url += f"?ownerUserId={quote(user_id, safe='')}"
        headers[SECRETS_USER_ID_HEADER] = user_id
    payload: dict[str, Any] = {"value": json.dumps(dict(tokens))}
    if expires_at:
        payload["expiresAt"] = expires_at

    async def _do(c: httpx.AsyncClient) -> httpx.Response:
        return await c.put(url, json=payload, headers=headers)

    if client is not None:
        res = await _do(client)
    else:
        async with httpx.AsyncClient() as owned:
            res = await _do(owned)

    if res.status_code >= 400:
        raise RuntimeError(
            f"oauth persist_oauth_tokens failed ({res.status_code}): {res.text}"
        )
    return res.json()

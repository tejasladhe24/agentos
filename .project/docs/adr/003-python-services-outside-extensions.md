# ADR 003 — Python services live under `services/`

## Status

Accepted

## Context

Extensions include TSX/TS. Colocating a FastAPI tree alongside React files harms DX (tooling, packaging, reviews).

## Decision

- TypeScript backends stay in `extensions/<id>/api/` (Bun).
- Python backends live in `services/<id>/` and are linked from `extensions/<id>/meta.json`.
- Python SDK is the separate package `agentos`, not `@agentos/core/python`.

## Consequences

- `agentos dev` must start both Bun APIs and Python services.
- Docs and skills must teach “extension vs service” explicitly.
- An extension may link a Python service **and** keep a Bun `api/` (ticket 83): `meta.service` beside `api.language: "bun"`. Python still lives under `services/`; the gateway exposes it under a documented mount (default `/_service`).

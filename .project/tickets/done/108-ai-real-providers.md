# 108 — AI: real model providers (platform env)

**Status:** done

## Goal

Replace the mock-only `ai` builtin with real model providers configured from platform env. Today `createAiModels` always returns mocks; `AGENT_OS_EXT_AI_MODEL` only flips a `mode` flag. This ticket must land before AI BYOK (ticket **109**).

## Depends on

- Ticket **18** / **85** (ai builtin, structured + multimodal) — done
- [ADR 006](../../docs/adr/006-vercel-ai-sdk.md) (Vercel AI SDK)

## Scope

1. **Provider factory** — `createAiModels(config)` builds language, embedding, and image models from a provider id + model ids using AI SDK provider packages. Initial providers: `openai`, `anthropic`, `google`, and an AI-gateway option (single key, many models). Mocks remain the default when unconfigured.
2. **Env** — `AGENT_OS_EXT_AI_PROVIDER`, `AGENT_OS_EXT_AI_API_KEY`, `AGENT_OS_EXT_AI_MODEL`, optional `AGENT_OS_EXT_AI_EMBEDDING_MODEL`, `AGENT_OS_EXT_AI_IMAGE_MODEL`, optional base URL / region. Validation via `createEnv`.
3. **Capability checks** — a provider without embeddings or images returns a clear error for that endpoint (no silent mock fallback in configured mode).
4. **Structure for per-request use** — factory is a pure function of config so ticket **109** can call it per org; cache built models by config hash.
5. **Data policy** — no customer documents used for training; document provider settings (e.g. zero-retention options where available).

## Out of scope

- Per-org keys (ticket **109**).
- Cost/usage metering.

## Done when

- [x] Real providers work for chat, structured output, embeddings, images (where supported)
- [x] Mocks still default when unconfigured; tests stay deterministic
- [x] Clear errors for unsupported capabilities and bad keys
- [x] Docs: `builtins.md` AI env table
- [x] `bun run ci` green

## Verify

- Unit: factory builds the right provider for each config (mocked SDK)
- Manual: set provider + key → chat works end to end in `agentos dev`

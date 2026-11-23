# ADR 006 — Vercel AI SDK v7 owns platform AI

## Status

Accepted

## Context

AgentOS needs a single platform AI surface (generateText / generateImage / embed, tools, composed extension instructions, Shell chat). Hand-rolling provider clients or parallel SDKs would fragment the builtin `ai` runtime and leak provider details into Shell and extensions.

## Decision

- Platform AI runtime lives only in driving builtin **`ai`**.
- **Vercel AI SDK v7** (`ai@^7`) is the sole LLM / tool orchestration library: `generateText` (including `Output.object` structured JSON and multimodal `file` parts), `generateImage`, `embed`, and `tool()`.
- No parallel OpenAI / Anthropic / other provider SDKs in platform code; no hand-rolled generate or tool loops.
- Public surface stays AgentOS HTTP (`/api/ext/ai/*`, `/api/agent/chat`) and `HostAPI.ai`; SDK types stay inside the builtin. Wire schemas are **JSON Schema** (language-neutral); Zod stays in-process only.
- Default local / test model: SDK mocks (`ai/test`) so `ai:dev` and unit tests work without API keys.
- Real providers are env-gated later and still invoked only through the `ai` package APIs.
- Extension tools map to `tool({ execute })` that `fetch`es the gateway `/api/ext/<id>/tools/<name>` — never direct upstream ports from the AI process’s public contract.
- Runtime remains **Bun** (ADR 001). Do not introduce Node to run the AI service.

## Consequences

- `@agentos/core` depends on `ai@^7`.
- Customer extensions declare tools in `agent/` and implement HTTP routes; they do not import `ai` for the platform path.
- Shell chat and `HostAPI.ai.generateText` call the builtin over HTTP, not providers directly.

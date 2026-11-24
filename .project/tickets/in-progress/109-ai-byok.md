# 109 — AI BYOK (per-org provider keys)

**Status:** in-progress

## Goal

Let an org use **its own AI provider account and model choice**, configured from Settings, falling back to the platform AI config when unset.

## Depends on

- Ticket **103** (integrations foundation)
- Ticket **108** (real providers)

## Scope

1. **Per-request models** — `ai` resolves the org's `ai` integration per request via `resolveProvider` and the ticket **108** factory; env config is the fallback.
2. **Integration shape** — `ai`: secrets `apiKey`; settings `provider`, `model`, optional `embeddingModel`, `imageModel`, `baseUrl`.
3. **Embedding consistency** — vector-store embeddings must come from one model per index. Changing the org's embedding model shows a warning and either blocks the change while vectors exist or marks indexes for re-embedding (decide during implementation; default: block with a clear message).
4. **Settings UI** — `ai` `ui/settings.tsx` section **AI**: provider picker, model selects (populated from the provider's model list where the API allows), masked key, source badge, test (short completion).
5. **Usage attribution** — record `source: 'org' | 'platform'` + provider/model on AI requests (audit or metrics) so platform cost vs org cost is visible.

## Out of scope

- Billing for platform-default usage.

## Done when

- [x] Org key/model used when set; platform env otherwise
- [x] Settings › AI configures, tests, and removes the integration
- [x] Embedding model change guarded
- [x] Tests: per-org isolation, fallback, rotation without restart
- [x] `bun run ci` green

## Verify

- Org A with its own key → chat uses org A provider (mocked); org B → platform config

# 85 — AI: structured JSON output + file/image inputs

**Status:** todo

## Goal

Extend the `ai` builtin and both SDKs with **schema-constrained JSON output** and **file/image inputs** (multimodal) for COI parsing, resume extraction, and similar portfolio agent tasks.

Source: [`.project/portfolio/portfolio-briefs.md`](../../portfolio/portfolio-briefs.md) — cross-platform gap formerly **70**.

## Depends on

- Ticket **18** (ai builtin) — done
- Ticket **82** (SDK parity) — can land clients together or immediately after

## Done when

- [ ] Generate endpoint accepts optional JSON schema / zod-like schema and returns parsed object or validation error
- [ ] Prompt path accepts file/image references (files builtin keys or inline base64 with size limits)
- [ ] TS + Python clients expose the new options
- [ ] Mock provider supports structured + image paths in tests
- [ ] Docs: provider requirements and size limits

## Notes

- Do not use customer documents for model training; keep provider/region configurable (existing TrustDesk NFR).

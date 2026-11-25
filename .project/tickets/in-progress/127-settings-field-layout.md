# 127 — Settings UI: Field-based layout for Files, AI, Email, and SMS

**Status:** in-progress

## Goal

Align the **Files**, **AI**, **Email**, and **SMS** settings pages with the **Profile** and **Organization** settings pages (`builtins/auth/ui/settings.tsx`): divide and separate sections using `@agentos/ui` **Field** primitives (`FieldGroup`, `FieldSet`, `FieldLegend`, `FieldDescription`, `Field`, `FieldContent`, `FieldSeparator`) rather than `Card` wrappers or bordered list boxes.

## Depends on

- Ticket **101** (Extension-registered Settings — established the Field-based Settings layout) — done
- Ticket **103** / **105** / **106** / **109** / **110**–**114** (BYOK integration & Files mounts Settings views) — done

## Scope

1. **Shared integration UI (`@agentos/core/client/components/integration-card.tsx`, `integration-section.tsx`):**
   - Replace `Card` (`CardHeader`, `CardTitle`, `CardDescription`, `CardAction`, `CardContent`, `CardFooter`) in `IntegrationCard` with `FieldSet`, `FieldLegend`, `FieldDescription`, and `FieldGroup`.
   - Use `Field orientation="responsive"` with `FieldContent` for `IntegrationProviderPicker`, `IntegrationTextField`, and `IntegrationSecretField` (matching `AccountProfileSection` / `AccountSecuritySection`).
   - Use `FieldDescription` for platform-default and read-only helper text instead of raw `<p>`/`<span>`.
   - Replace warning/error/unconfigured status badges (e.g. "Platform default (not configured)", "Not set", disconnected/error mounts, manual/failing webhook status) with a compact `(i)` info icon (`IntegrationStatusInfo` + `@agentos/ui` Tooltip) on the left of the subsection/field label with hover text.
2. **Files settings (`builtins/files/ui/settings.tsx`, `storage-backends.tsx`):**
   - Separate `StorageBackends`, `ConnectedDrives`, and `Bin auto-delete` with `FieldSeparator` inside `FieldGroup className="gap-8"`.
   - Call `useSettingsTarget()` so Settings search deep-links scroll/highlight entries.
   - Replace the bordered card-like `<ul>` containers in `StorageBackends` and `ConnectedDrives` with `FieldGroup` + `Field orientation="horizontal"` rows (`FieldContent`, `FieldTitle`, `FieldDescription`).
3. **AI settings (`builtins/ai/ui/settings.tsx`, `ai-model-field.tsx`):**
   - Use the standard Settings scroll container (`fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground`) + `FieldGroup className="gap-8"` and `useSettingsTarget()`.
   - Render `AiModelField` with `Field orientation="responsive"` + `FieldContent` and `AiModelCatalogLoader` with `Field orientation="horizontal"`.
4. **Email settings (`builtins/inbound-email/ui/settings.tsx`, `receiving-card.tsx`):**
   - Separate Email sending (`IntegrationSection`) and Email receiving (`ReceivingCard`) with `FieldSeparator` inside `FieldGroup className="gap-8"`.
   - Update `ReceivingCard` rows (webhook status, webhook URL, checkbox, helper text) to use `Field` / `FieldContent` / `FieldTitle` / `FieldDescription`.
5. **SMS settings (`builtins/notifications/ui/settings.tsx`):**
   - Wrap `IntegrationSection` in `FieldGroup className="gap-8"` so it uses the same Field-based layout without `Card`.

## Out of scope

- Backend/API behavior or schema changes for Files, AI, Email, or SMS integrations.
- Renaming exported component symbols (`IntegrationCard`, `ReceivingCard`) to avoid unnecessary breaking churn.

## Done when

- [x] `IntegrationCard` / `IntegrationSection` render with `FieldSet` / `FieldGroup` / `Field` and no `Card`
- [x] Files settings separates sections with `FieldSeparator` and renders mount lists as `Field` rows
- [x] AI settings uses the standard Settings container, `FieldGroup`, and responsive `Field` controls
- [x] Email settings separates Sending and Receiving with `FieldSeparator` and uses `Field` primitives throughout
- [x] SMS settings renders with `FieldGroup` / `FieldSet` and no `Card`
- [x] Unit tests verify Field-based layout (and absence of `Card`) across integration and builtin settings views
- [x] `bun run ci` green

## Verify

- `pnpm install` then `bun run ci`
- Local `agentos dev` → Settings → inspect **Profile**, **Organization**, **Files**, **AI**, **Email**, and **SMS** to confirm consistent Field-based section dividers and zero Cards

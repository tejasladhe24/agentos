/**
 * Helpers bridging `@tanstack/react-form` + `zod` (Standard Schema) validation
 * errors to `@agentos/ui/components/field` (`Field` / `FieldError`).
 */

export type UiFieldError = { message?: string } | undefined;

/** Normalizes TanStack Form / Zod errors for `<FieldError errors={...} />`. */
export function toFieldErrors(errors: readonly unknown[]): UiFieldError[] {
  const out: UiFieldError[] = [];
  for (const err of errors) {
    if (!err) continue;
    if (typeof err === 'string') {
      out.push({ message: err });
    } else if (typeof err === 'object' && 'message' in err) {
      const message = (err as { message?: unknown }).message;
      if (typeof message === 'string' && message) {
        out.push({ message });
      }
    }
  }
  return out;
}

/** True when a TanStack Form field should render its invalid styling & errors. */
export function isFieldInvalid(meta: {
  isTouched: boolean;
  isValid: boolean;
  errors: readonly unknown[];
}): boolean {
  return meta.isTouched && !meta.isValid && meta.errors.length > 0;
}

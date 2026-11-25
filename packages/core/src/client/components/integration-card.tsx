import { useState, type ReactNode } from 'react';
import { InfoIcon } from '@phosphor-icons/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@agentos/ui/components/alert-dialog';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentos/ui/components/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agentos/ui/components/tooltip';
import { cn } from '@agentos/ui/lib/utils';

import type { UiFieldError } from '../lib/form-errors';

/** Shared building blocks for builtin integration Settings sections (ticket 103). */

export type IntegrationSource = 'tenant' | 'platform';

export type IntegrationFieldSpec = {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
};

export type IntegrationProviderSpec = {
  id: string;
  label: string;
  description?: string;
  settings: IntegrationFieldSpec[];
  secrets: IntegrationFieldSpec[];
};

export type IntegrationSecretStatus = { set: true; updatedAt?: string };

export type IntegrationTestOutcome = {
  ok: boolean;
  message?: string;
  source?: IntegrationSource | 'draft';
};

export type IntegrationStatusTone = 'warning' | 'error' | 'info';

function formatStamp(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * Compact `(i)` icon with hover tooltip text for warning, error, or
 * unconfigured states. Defaults to `position="gutter"`, which places the icon
 * absolutely in the left margin (`-left-5`) of a `relative` label container so
 * the label text stays vertically aligned with sibling fields.
 */
export function IntegrationStatusInfo({
  message,
  tone = 'warning',
  slot = 'status-info',
  position = 'gutter',
}: {
  message: string;
  tone?: IntegrationStatusTone;
  slot?: string;
  position?: 'gutter' | 'inline';
}) {
  const toneClass =
    tone === 'error'
      ? 'text-destructive hover:text-destructive/80'
      : tone === 'warning'
        ? 'text-amber-500 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-300'
        : 'text-muted-foreground hover:text-foreground';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          type="button"
          aria-label={message}
          data-slot={slot}
          data-tone={tone}
          className={cn(
            'inline-flex shrink-0 cursor-help items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
            position === 'gutter' &&
              'absolute top-1/2 -left-5 -translate-y-1/2',
            toneClass,
          )}
        >
          <InfoIcon className="size-3.5" aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="top">{message}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function IntegrationSourceBadge({
  source,
  platformConfigured = true,
}: {
  source: IntegrationSource;
  platformConfigured?: boolean;
}) {
  if (source === 'tenant') {
    return <Badge data-slot="integration-source">Using your key</Badge>;
  }
  if (!platformConfigured) {
    return (
      <IntegrationStatusInfo
        message="Platform default (not configured)"
        tone="warning"
        slot="integration-source"
        position="inline"
      />
    );
  }
  return (
    <Badge variant="secondary" data-slot="integration-source">
      Platform default
    </Badge>
  );
}

export function IntegrationProviderPicker({
  id,
  providers,
  value,
  onValueChange,
  disabled,
  errors,
}: {
  id?: string;
  providers: IntegrationProviderSpec[];
  value: string;
  onValueChange: (provider: string) => void;
  disabled?: boolean;
  errors?: UiFieldError[];
}) {
  const items = providers.map((p) => ({ value: p.id, label: p.label }));
  const active = providers.find((p) => p.id === value);
  const invalid = Boolean(errors?.length);
  return (
    <Field
      orientation="responsive"
      data-slot="integration-provider"
      data-invalid={invalid || undefined}
    >
      <FieldContent>
        <FieldLabel htmlFor={id}>Provider</FieldLabel>
        {active?.description ? (
          <FieldDescription>{active.description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError errors={errors} /> : null}
      </FieldContent>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => {
          if (typeof next === 'string') onValueChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="w-full sm:max-w-60"
          aria-invalid={invalid || undefined}
        >
          <SelectValue placeholder="Choose a provider" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function IntegrationTextField({
  id,
  field,
  value,
  onValueChange,
  onBlur,
  disabled,
  errors,
}: {
  id: string;
  field: IntegrationFieldSpec;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  errors?: UiFieldError[];
}) {
  const invalid = Boolean(errors?.length);
  return (
    <Field
      orientation="responsive"
      data-slot="integration-setting"
      data-invalid={invalid || undefined}
    >
      <FieldContent>
        <FieldLabel htmlFor={id}>
          {field.label}
          {field.required ? null : (
            <span className="text-muted-foreground"> (optional)</span>
          )}
        </FieldLabel>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError errors={errors} /> : null}
      </FieldContent>
      <Input
        id={id}
        value={value}
        placeholder={field.placeholder}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onBlur={onBlur}
        onChange={(e) => onValueChange(e.target.value)}
        className="sm:max-w-60"
      />
    </Field>
  );
}

/**
 * Write-only secret input. Shows "Set / Not set"; values are never displayed —
 * a set secret can only be replaced. Unset secrets show an `(i)` icon in the
 * label gutter instead of a "Not set" badge.
 */
export function IntegrationSecretField({
  id,
  field,
  status,
  value,
  onValueChange,
  onBlur,
  disabled,
  errors,
}: {
  id: string;
  field: IntegrationFieldSpec;
  status?: IntegrationSecretStatus;
  value: string;
  onValueChange: (value: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  errors?: UiFieldError[];
}) {
  const [replacing, setReplacing] = useState(false);
  const isSet = status?.set === true;
  const editing = !isSet || replacing;
  const stamp = formatStamp(status?.updatedAt);
  const invalid = Boolean(errors?.length);

  return (
    <Field
      orientation="responsive"
      data-slot="integration-secret"
      data-invalid={invalid || undefined}
    >
      <FieldContent>
        <div className="relative flex items-center">
          {!isSet ? (
            <IntegrationStatusInfo
              message="Not set"
              tone="warning"
              slot="integration-secret-status"
            />
          ) : null}
          <FieldLabel htmlFor={editing ? id : undefined}>
            {field.label}
            {isSet ? (
              <Badge
                variant="outline"
                className="ml-2"
                data-slot="integration-secret-status"
              >
                Set
              </Badge>
            ) : null}
          </FieldLabel>
        </div>
        {field.description ? (
          <FieldDescription>{field.description}</FieldDescription>
        ) : null}
        {invalid ? <FieldError errors={errors} /> : null}
      </FieldContent>
      {editing ? (
        <div className="flex w-full items-center gap-2 sm:max-w-60">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={
              field.placeholder ?? (isSet ? 'Enter a new value' : '')
            }
            disabled={disabled}
            aria-invalid={invalid || undefined}
            onBlur={onBlur}
            onChange={(e) => onValueChange(e.target.value)}
          />
          {isSet ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setReplacing(false);
                onValueChange('');
              }}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="font-mono text-xs text-muted-foreground">
            ••••••••
          </span>
          {stamp ? (
            <span className="text-xs text-muted-foreground">
              updated {stamp}
            </span>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => setReplacing(true)}
          >
            Replace
          </Button>
        </div>
      )}
    </Field>
  );
}

export function IntegrationTestButton({
  onTest,
  disabled,
}: {
  onTest: () => Promise<IntegrationTestOutcome>;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<IntegrationTestOutcome | null>(null);

  return (
    <div className="flex items-center gap-2" data-slot="integration-test">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          try {
            setResult(await onTest());
          } catch {
            setResult({ ok: false, message: 'Test request failed' });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Testing…' : 'Test connection'}
      </Button>
      {result ? (
        <span
          className={
            result.ok ? 'text-xs text-foreground' : 'text-xs text-destructive'
          }
          data-slot="integration-test-result"
          role="status"
        >
          {result.ok ? 'Connected' : 'Failed'}
          {result.message ? ` — ${result.message}` : ''}
        </span>
      ) : null}
    </div>
  );
}

export function IntegrationRemoveButton({
  name,
  onConfirm,
  disabled,
}: {
  name: string;
  onConfirm: () => Promise<void> | void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes your saved settings and keys for this integration. The
              platform default is used afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function IntegrationCard({
  title,
  description,
  source,
  platformConfigured = true,
  children,
  footer,
  entryId,
}: {
  title: string;
  description?: string;
  source: IntegrationSource;
  platformConfigured?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  /** `data-setting-entry` anchor for Settings search deep-links. */
  entryId?: string;
}) {
  const unconfigured = source === 'platform' && !platformConfigured;
  return (
    <FieldSet data-setting-entry={entryId}>
      <FieldLegend className="flex w-full items-center justify-between gap-2">
        <span className="relative inline-flex items-center">
          {unconfigured ? (
            <IntegrationStatusInfo
              message="Platform default (not configured)"
              tone="warning"
              slot="integration-source"
            />
          ) : null}
          <span>{title}</span>
        </span>
        {unconfigured ? null : (
          <IntegrationSourceBadge
            source={source}
            platformConfigured={platformConfigured}
          />
        )}
      </FieldLegend>
      {description ? <FieldDescription>{description}</FieldDescription> : null}
      <FieldGroup>
        {children}
        {footer ? (
          <Field
            orientation="horizontal"
            className="flex-wrap items-center gap-2"
          >
            {footer}
          </Field>
        ) : null}
      </FieldGroup>
    </FieldSet>
  );
}

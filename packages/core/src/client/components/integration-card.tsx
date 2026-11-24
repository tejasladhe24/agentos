import { useState, type ReactNode } from 'react';
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
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@agentos/ui/components/card';
import {
  Field,
  FieldDescription,
  FieldLabel,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentos/ui/components/select';

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

function formatStamp(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
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
  return (
    <Badge variant="secondary" data-slot="integration-source">
      {platformConfigured
        ? 'Platform default'
        : 'Platform default (not configured)'}
    </Badge>
  );
}

export function IntegrationProviderPicker({
  id,
  providers,
  value,
  onValueChange,
  disabled,
}: {
  id?: string;
  providers: IntegrationProviderSpec[];
  value: string;
  onValueChange: (provider: string) => void;
  disabled?: boolean;
}) {
  const items = providers.map((p) => ({ value: p.id, label: p.label }));
  return (
    <Field data-slot="integration-provider">
      <FieldLabel htmlFor={id}>Provider</FieldLabel>
      <Select
        items={items}
        value={value || null}
        onValueChange={(next) => {
          if (typeof next === 'string') onValueChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full max-w-xs">
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
  disabled,
}: {
  id: string;
  field: IntegrationFieldSpec;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field data-slot="integration-setting">
      <FieldLabel htmlFor={id}>
        {field.label}
        {field.required ? null : (
          <span className="text-muted-foreground"> (optional)</span>
        )}
      </FieldLabel>
      <Input
        id={id}
        value={value}
        placeholder={field.placeholder}
        disabled={disabled}
        onChange={(e) => onValueChange(e.target.value)}
      />
      {field.description ? (
        <FieldDescription>{field.description}</FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * Write-only secret input. Shows "Set / Not set"; values are never displayed —
 * a set secret can only be replaced.
 */
export function IntegrationSecretField({
  id,
  field,
  status,
  value,
  onValueChange,
  disabled,
}: {
  id: string;
  field: IntegrationFieldSpec;
  status?: IntegrationSecretStatus;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [replacing, setReplacing] = useState(false);
  const isSet = status?.set === true;
  const editing = !isSet || replacing;
  const stamp = formatStamp(status?.updatedAt);

  return (
    <Field data-slot="integration-secret">
      <FieldLabel htmlFor={editing ? id : undefined}>
        {field.label}
        <Badge
          variant={isSet ? 'outline' : 'secondary'}
          className="ml-2"
          data-slot="integration-secret-status"
        >
          {isSet ? 'Set' : 'Not set'}
        </Badge>
      </FieldLabel>
      {editing ? (
        <div className="flex gap-2">
          <Input
            id={id}
            type="password"
            autoComplete="off"
            value={value}
            placeholder={
              field.placeholder ?? (isSet ? 'Enter a new value' : '')
            }
            disabled={disabled}
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
        <div className="flex items-center gap-2">
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
      {field.description ? (
        <FieldDescription>{field.description}</FieldDescription>
      ) : null}
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
  platformConfigured,
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
  return (
    <Card data-slot="integration-card" data-setting-entry={entryId}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
        <CardAction>
          <IntegrationSourceBadge
            source={source}
            platformConfigured={platformConfigured}
          />
        </CardAction>
      </CardHeader>
      {children ? (
        <CardContent className="flex flex-col gap-4">{children}</CardContent>
      ) : null}
      {footer ? <CardFooter className="gap-2">{footer}</CardFooter> : null}
    </Card>
  );
}

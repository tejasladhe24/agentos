import { useState, type FormEvent } from 'react';
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
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';

import type { AccountOrgMembership } from './account-types';

export type AccountOrganizationSectionProps = {
  orgId: string | null;
  orgs: AccountOrgMembership[];
  busy?: boolean;
  onCreateOrg: (name: string) => Promise<void>;
  onSwitchOrg: (orgId: string) => Promise<void>;
};

export function AccountOrganizationSection({
  orgId,
  orgs,
  busy = false,
  onCreateOrg,
  onSwitchOrg,
}: AccountOrganizationSectionProps) {
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setLocalError('Name required');
      return;
    }
    setPending(true);
    setLocalError(null);
    try {
      await onCreateOrg(trimmed);
      setName('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setPending(false);
    }
  }

  async function handleSwitch(nextOrgId: string) {
    if (nextOrgId === orgId) return;
    setPending(true);
    setLocalError(null);
    try {
      await onSwitchOrg(nextOrgId);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Switch failed');
    } finally {
      setPending(false);
    }
  }

  const disabled = busy || pending;
  const invalid = Boolean(localError);

  return (
    <FieldGroup data-slot="account-organization">
      <FieldSet data-setting-entry="active-org">
        <FieldLegend>Active organization</FieldLegend>
        <FieldDescription>
          Tenant context for db-store and extension APIs.
        </FieldDescription>
        <FieldGroup>
          {orgs.length === 0 ? (
            <FieldDescription>
              You are not a member of any organization yet.
            </FieldDescription>
          ) : (
            orgs.map((org) => {
              const active = org.id === orgId;
              return (
                <Field key={org.id} orientation="horizontal">
                  <FieldContent>
                    <FieldTitle>{org.name}</FieldTitle>
                    <FieldDescription>{org.role}</FieldDescription>
                  </FieldContent>
                  {active ? (
                    <Badge variant="secondary">Active</Badge>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={disabled}
                      onClick={() => void handleSwitch(org.id)}
                    >
                      Switch
                    </Button>
                  )}
                </Field>
              );
            })
          )}
        </FieldGroup>
      </FieldSet>

      <FieldSeparator />

      <form onSubmit={handleCreate}>
        <FieldSet data-setting-entry="create-org">
          <FieldLegend>Create organization</FieldLegend>
          <FieldDescription>
            You become the owner and it becomes your active organization.
          </FieldDescription>
          <FieldGroup>
            <Field orientation="responsive" data-invalid={invalid || undefined}>
              <FieldContent>
                <FieldLabel htmlFor="account-new-org">
                  Organization name
                </FieldLabel>
                <FieldDescription>
                  Enter a name for your new workspace tenant.
                </FieldDescription>
                {localError ? <FieldError>{localError}</FieldError> : null}
              </FieldContent>
              <Input
                id="account-new-org"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder="Acme Inc."
                disabled={disabled}
                aria-invalid={invalid || undefined}
                className="sm:max-w-60"
              />
            </Field>
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" size="sm" disabled={disabled}>
                Create
              </Button>
            </Field>
          </FieldGroup>
        </FieldSet>
      </form>
    </FieldGroup>
  );
}

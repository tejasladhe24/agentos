import { useState, type FormEvent } from 'react';
import { Button } from '@agentos/ui/components/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@agentos/ui/components/card';
import { Input } from '@agentos/ui/components/input';
import { Badge } from '@agentos/ui/components/badge';

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

  return (
    <div className="flex flex-col gap-4" data-slot="account-organization">
      <Card size="sm">
        <CardHeader>
          <CardTitle>Active organization</CardTitle>
          <CardDescription>
            Tenant context for db-store and extension APIs
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {orgs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You are not a member of any organization yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {orgs.map((org) => {
                const active = org.id === orgId;
                return (
                  <li
                    key={org.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{org.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {org.role}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
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
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle>Create organization</CardTitle>
          <CardDescription>
            You become the owner and it becomes your active org
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex flex-col gap-3" onSubmit={handleCreate}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Organization name"
              disabled={disabled}
              aria-label="Organization name"
            />
            {localError ? (
              <p className="text-xs text-destructive" role="alert">
                {localError}
              </p>
            ) : null}
            <Button type="submit" disabled={disabled}>
              Create
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

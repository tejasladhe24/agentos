import { useMemo, useState, type FormEvent } from 'react';
import {
  ArrowsDownUpIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@phosphor-icons/react';
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
  ButtonGroup,
  ButtonGroupSeparator,
} from '@agentos/ui/components/button-group';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@agentos/ui/components/dropdown-menu';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@agentos/ui/components/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import type { AccountOrgMembership } from './account-types';

export type AccountOrganizationSectionProps = {
  orgId: string | null;
  orgs: AccountOrgMembership[];
  isAdmin?: boolean;
  busy?: boolean;
  onCreateOrg: (name: string) => Promise<void>;
  onSwitchOrg: (orgId: string) => Promise<void>;
  onUpdateOrg?: (orgId: string, name: string) => Promise<void>;
  onDeleteOrg?: (orgId: string) => Promise<void>;
};

export function AccountOrganizationSection({
  orgId,
  orgs,
  isAdmin = false,
  busy = false,
  onCreateOrg,
  onSwitchOrg,
  onUpdateOrg,
  onDeleteOrg,
}: AccountOrganizationSectionProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [activeOnly, setActiveOnly] = useState(false);
  const [sortBy, setSortBy] = useState<
    'name-asc' | 'name-desc' | 'role-asc' | 'active-first'
  >('name-asc');

  const orgRoles = useMemo(
    () => [...new Set(orgs.map((o) => o.role))].sort(),
    [orgs],
  );
  const hasFilter = roleFilter !== 'all' || activeOnly;

  const filteredOrgs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = orgs.filter((o) => {
      if (activeOnly && o.id !== orgId) return false;
      if (roleFilter !== 'all' && o.role !== roleFilter) return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) || o.role.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
      if (sortBy === 'role-asc') {
        return a.role.localeCompare(b.role) || a.name.localeCompare(b.name);
      }
      if (sortBy === 'active-first') {
        const aActive = a.id === orgId ? 0 : 1;
        const bActive = b.id === orgId ? 0 : 1;
        return aActive - bActive || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [orgs, orgId, searchQuery, roleFilter, activeOnly, sortBy]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');

  const [editingOrg, setEditingOrg] = useState<AccountOrgMembership | null>(
    null,
  );
  const [editName, setEditName] = useState('');

  const [deletingOrg, setDeletingOrg] = useState<AccountOrgMembership | null>(
    null,
  );

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const trimmed = createName.trim();
    if (!trimmed) {
      setLocalError('Name required');
      return;
    }
    setPending(true);
    setLocalError(null);
    try {
      await onCreateOrg(trimmed);
      setCreateName('');
      setCreateOpen(false);
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

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editingOrg || !onUpdateOrg) return;
    const trimmed = editName.trim();
    if (!trimmed) {
      setLocalError('Name required');
      return;
    }
    setPending(true);
    setLocalError(null);
    try {
      await onUpdateOrg(editingOrg.id, trimmed);
      setEditingOrg(null);
      setEditName('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!deletingOrg || !onDeleteOrg) return;
    setPending(true);
    setLocalError(null);
    try {
      await onDeleteOrg(deletingOrg.id);
      setDeletingOrg(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setPending(false);
    }
  }

  const disabled = busy || pending;
  const showActionsColumn = isAdmin || orgs.some((o) => o.id !== orgId);

  return (
    <FieldSet
      data-slot="account-organization"
      data-setting-entry="organizations"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <FieldLegend>Organizations</FieldLegend>
          <FieldDescription>
            Organizations you belong to and your active tenant workspace.
          </FieldDescription>
        </div>
        {isAdmin ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-slot="create-org-trigger"
            onClick={() => {
              setLocalError(null);
              setCreateName('');
              setCreateOpen(true);
            }}
          >
            <PlusIcon className="size-3.5" aria-hidden />
            Create organization
          </Button>
        ) : null}
      </div>

      {localError ? <FieldError>{localError}</FieldError> : null}

      <FieldGroup>
        {orgs.length === 0 ? (
          <FieldDescription>
            You are not a member of any organization yet.
          </FieldDescription>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <InputGroup className="max-w-xs">
                <InputGroupInput
                  placeholder="Search organizations…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search organizations"
                  data-slot="organizations-search"
                />
                <InputGroupAddon>
                  <MagnifyingGlassIcon
                    className="size-4 shrink-0 opacity-50"
                    aria-hidden
                  />
                </InputGroupAddon>
              </InputGroup>
              <ButtonGroup>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Filter organizations"
                        data-slot="organizations-filter"
                      />
                    }
                  >
                    <FunnelIcon
                      className="size-4"
                      weight={hasFilter ? 'fill' : 'regular'}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Filter by role</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={roleFilter}
                        onValueChange={setRoleFilter}
                      >
                        <DropdownMenuRadioItem value="all">
                          All roles
                        </DropdownMenuRadioItem>
                        {orgRoles.map((role) => (
                          <DropdownMenuRadioItem key={role} value={role}>
                            {role}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuCheckboxItem
                      checked={activeOnly}
                      onCheckedChange={(checked) =>
                        setActiveOnly(checked === true)
                      }
                    >
                      Active only
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <ButtonGroupSeparator />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label="Sort organizations"
                        data-slot="organizations-sort"
                      />
                    }
                  >
                    <ArrowsDownUpIcon className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={sortBy}
                        onValueChange={(v) =>
                          setSortBy(
                            v as
                              | 'name-asc'
                              | 'name-desc'
                              | 'role-asc'
                              | 'active-first',
                          )
                        }
                      >
                        <DropdownMenuRadioItem value="name-asc">
                          Name (A → Z)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="name-desc">
                          Name (Z → A)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="role-asc">
                          Role (A → Z)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="active-first">
                          Active first
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            </div>
            <div className="rounded-none border border-border">
              <Table data-slot="organizations-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Organization</TableHead>
                    <TableHead>Role</TableHead>
                    {showActionsColumn ? (
                      <TableHead className="w-12 text-right" />
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrgs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={showActionsColumn ? 3 : 2}
                        className="py-6 text-center text-muted-foreground"
                      >
                        No matching organizations.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrgs.map((org) => {
                      const active = org.id === orgId;
                      return (
                        <TableRow
                          key={org.id}
                          data-org-id={org.id}
                          data-state={active ? 'selected' : undefined}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{org.name}</span>
                              {active ? (
                                <CheckCircleIcon
                                  weight="fill"
                                  className="size-3.5 shrink-0 text-primary"
                                  aria-label="Active organization"
                                />
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{org.role}</Badge>
                          </TableCell>
                          {showActionsColumn ? (
                            <TableCell className="text-right">
                              {isAdmin ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        disabled={disabled}
                                        aria-label={`Actions for ${org.name}`}
                                        data-slot="org-row-actions"
                                      />
                                    }
                                  >
                                    <DotsThreeIcon className="size-4" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {!active ? (
                                      <DropdownMenuItem
                                        onClick={() =>
                                          void handleSwitch(org.id)
                                        }
                                      >
                                        Switch to organization
                                      </DropdownMenuItem>
                                    ) : null}
                                    {onUpdateOrg ? (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setLocalError(null);
                                          setEditingOrg(org);
                                          setEditName(org.name);
                                        }}
                                      >
                                        Update organization
                                      </DropdownMenuItem>
                                    ) : null}
                                    {onDeleteOrg ? (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          variant="destructive"
                                          disabled={orgs.length <= 1}
                                          onClick={() => {
                                            setLocalError(null);
                                            setDeletingOrg(org);
                                          }}
                                        >
                                          Delete organization
                                        </DropdownMenuItem>
                                      </>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : !active ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  disabled={disabled}
                                  onClick={() => void handleSwitch(org.id)}
                                >
                                  Switch
                                </Button>
                              ) : null}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </FieldGroup>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
              <DialogDescription>
                Enter a name for the new workspace tenant.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="account-new-org">
                Organization name
              </FieldLabel>
              <Input
                id="account-new-org"
                value={createName}
                onChange={(e) => {
                  setCreateName(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder="Acme Inc."
                disabled={disabled}
                autoFocus
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={disabled}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingOrg !== null}
        onOpenChange={(open) => {
          if (!open) setEditingOrg(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Update organization</DialogTitle>
              <DialogDescription>Rename {editingOrg?.name}.</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="account-edit-org">
                Organization name
              </FieldLabel>
              <Input
                id="account-edit-org"
                value={editName}
                onChange={(e) => {
                  setEditName(e.target.value);
                  if (localError) setLocalError(null);
                }}
                disabled={disabled}
                autoFocus
              />
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setEditingOrg(null)}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={disabled}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deletingOrg !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingOrg(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingOrg?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the organization and its memberships.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabled}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={() => void handleDelete()}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldSet>
  );
}

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
import { Textarea } from '@agentos/ui/components/textarea';

import type { AccountRoleEntry } from './account-types';

const PROTECTED_ROLES = new Set(['admin', 'owner']);
const BUILTIN_ROLES = new Set([
  'admin',
  'owner',
  'reviewer',
  'sales',
  'viewer',
  'external_viewer',
]);

export type AccountRolesSectionProps = {
  /** Current user's assigned roles. */
  roles: string[];
  /** All roles available in the organization. */
  availableRoles?: AccountRoleEntry[];
  isAdmin?: boolean;
  busy?: boolean;
  onSaveRole?: (role: string, permissions: string[]) => Promise<void>;
  onDeleteRole?: (role: string) => Promise<void>;
};

function parsePermissionsInput(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
    ),
  ];
}

function formatPermissionsSummary(permissions: readonly string[]): string {
  if (permissions.includes('*')) return 'All permissions (*)';
  if (permissions.length === 0) return 'None';
  return permissions.join(', ');
}

export function AccountRolesSection({
  roles,
  availableRoles,
  isAdmin = false,
  busy = false,
  onSaveRole,
  onDeleteRole,
}: AccountRolesSectionProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<
    'all' | 'assigned' | 'builtin' | 'custom'
  >('all');
  const [sortBy, setSortBy] = useState<
    'name-asc' | 'name-desc' | 'perms-desc' | 'assigned-first'
  >('name-asc');

  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRolePerms, setNewRolePerms] = useState('');

  const [editingRole, setEditingRole] = useState<AccountRoleEntry | null>(null);
  const [editPerms, setEditPerms] = useState('');

  const [deletingRole, setDeletingRole] = useState<string | null>(null);

  const assignedSet = useMemo(() => new Set(roles), [roles]);
  const rows: AccountRoleEntry[] = useMemo(
    () => availableRoles ?? roles.map((role) => ({ role, permissions: [] })),
    [availableRoles, roles],
  );
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = rows.filter((entry) => {
      if (roleFilter === 'assigned' && !assignedSet.has(entry.role))
        return false;
      if (roleFilter === 'builtin' && !BUILTIN_ROLES.has(entry.role))
        return false;
      if (roleFilter === 'custom' && BUILTIN_ROLES.has(entry.role))
        return false;
      if (!q) return true;
      return (
        entry.role.toLowerCase().includes(q) ||
        entry.permissions.some((p) => p.toLowerCase().includes(q))
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'name-desc') return b.role.localeCompare(a.role);
      if (sortBy === 'perms-desc') {
        const aScore = a.permissions.includes('*')
          ? Number.MAX_SAFE_INTEGER
          : a.permissions.length;
        const bScore = b.permissions.includes('*')
          ? Number.MAX_SAFE_INTEGER
          : b.permissions.length;
        return bScore - aScore || a.role.localeCompare(b.role);
      }
      if (sortBy === 'assigned-first') {
        const aAssigned = assignedSet.has(a.role) ? 0 : 1;
        const bAssigned = assignedSet.has(b.role) ? 0 : 1;
        return aAssigned - bAssigned || a.role.localeCompare(b.role);
      }
      return a.role.localeCompare(b.role);
    });
  }, [rows, assignedSet, searchQuery, roleFilter, sortBy]);

  const disabled = busy || pending;

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!onSaveRole) return;
    const trimmed = newRoleName.trim();
    if (!trimmed) {
      setLocalError('Role name required');
      return;
    }
    const perms = parsePermissionsInput(newRolePerms);
    if (perms.length === 0) {
      setLocalError('At least one permission is required');
      return;
    }
    setPending(true);
    setLocalError(null);
    try {
      await onSaveRole(trimmed, perms);
      setCreateOpen(false);
      setNewRoleName('');
      setNewRolePerms('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Create role failed');
    } finally {
      setPending(false);
    }
  }

  async function handleUpdate(e: FormEvent) {
    e.preventDefault();
    if (!editingRole || !onSaveRole) return;
    const perms = parsePermissionsInput(editPerms);
    setPending(true);
    setLocalError(null);
    try {
      await onSaveRole(editingRole.role, perms);
      setEditingRole(null);
      setEditPerms('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Update role failed');
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!deletingRole || !onDeleteRole) return;
    setPending(true);
    setLocalError(null);
    try {
      await onDeleteRole(deletingRole);
      setDeletingRole(null);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Delete role failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <FieldSet data-slot="account-roles" data-setting-entry="roles">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <FieldLegend>Roles</FieldLegend>
          <FieldDescription>
            Roles available in this organization and their granted permissions.
          </FieldDescription>
        </div>
        {isAdmin && onSaveRole ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-slot="create-role-trigger"
            onClick={() => {
              setLocalError(null);
              setNewRoleName('');
              setNewRolePerms('auth.session.read, files.read, email.read');
              setCreateOpen(true);
            }}
          >
            <PlusIcon className="size-3.5" aria-hidden />
            Create role
          </Button>
        ) : null}
      </div>

      {localError ? <FieldError>{localError}</FieldError> : null}

      <FieldGroup>
        {rows.length === 0 ? (
          <FieldDescription>No roles assigned</FieldDescription>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <InputGroup className="max-w-xs">
                <InputGroupInput
                  placeholder="Search roles…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search roles"
                  data-slot="roles-search"
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
                        aria-label="Filter roles"
                        data-slot="roles-filter"
                      />
                    }
                  >
                    <FunnelIcon
                      className="size-4"
                      weight={roleFilter !== 'all' ? 'fill' : 'regular'}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Filter roles</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={roleFilter}
                        onValueChange={(v) =>
                          setRoleFilter(
                            v as 'all' | 'assigned' | 'builtin' | 'custom',
                          )
                        }
                      >
                        <DropdownMenuRadioItem value="all">
                          All roles
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="assigned">
                          Assigned to you
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="builtin">
                          Built-in roles
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="custom">
                          Custom roles
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
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
                        aria-label="Sort roles"
                        data-slot="roles-sort"
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
                              | 'perms-desc'
                              | 'assigned-first',
                          )
                        }
                      >
                        <DropdownMenuRadioItem value="name-asc">
                          Role (A → Z)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="name-desc">
                          Role (Z → A)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="perms-desc">
                          Most permissions
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="assigned-first">
                          Assigned first
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            </div>
            <div className="rounded-none border border-border">
              <Table data-slot="roles-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead>Permissions</TableHead>
                    {isAdmin ? <TableHead className="w-12 text-right" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 3 : 2}
                        className="py-6 text-center text-muted-foreground"
                      >
                        No matching roles.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((entry) => {
                      const isProtected = PROTECTED_ROLES.has(entry.role);
                      const assigned = assignedSet.has(entry.role);
                      return (
                        <TableRow
                          key={entry.role}
                          data-role-name={entry.role}
                          data-state={assigned ? 'selected' : undefined}
                        >
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span>{entry.role}</span>
                              {assigned ? (
                                <CheckCircleIcon
                                  weight="fill"
                                  className="size-3.5 shrink-0 text-primary"
                                  aria-label="Assigned to you"
                                />
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="whitespace-normal text-muted-foreground">
                            {formatPermissionsSummary(entry.permissions)}
                          </TableCell>
                          {isAdmin ? (
                            <TableCell className="text-right">
                              <DropdownMenu>
                                <DropdownMenuTrigger
                                  render={
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      disabled={disabled}
                                      aria-label={`Actions for ${entry.role}`}
                                      data-slot="role-row-actions"
                                    />
                                  }
                                >
                                  <DotsThreeIcon className="size-4" />
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end">
                                  {onSaveRole ? (
                                    <DropdownMenuItem
                                      onClick={() => {
                                        setLocalError(null);
                                        setEditingRole(entry);
                                        setEditPerms(
                                          entry.permissions.join(', '),
                                        );
                                      }}
                                    >
                                      Update role
                                    </DropdownMenuItem>
                                  ) : null}
                                  {onDeleteRole ? (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        variant="destructive"
                                        disabled={isProtected}
                                        onClick={() => {
                                          setLocalError(null);
                                          setDeletingRole(entry.role);
                                        }}
                                      >
                                        Delete role
                                      </DropdownMenuItem>
                                    </>
                                  ) : null}
                                </DropdownMenuContent>
                              </DropdownMenu>
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
              <DialogTitle>Create role</DialogTitle>
              <DialogDescription>
                Define a role name and comma-separated permissions.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="account-new-role-name">Role name</FieldLabel>
              <Input
                id="account-new-role-name"
                value={newRoleName}
                onChange={(e) => {
                  setNewRoleName(e.target.value);
                  if (localError) setLocalError(null);
                }}
                placeholder="analyst"
                disabled={disabled}
                autoFocus
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="account-new-role-perms">
                Permissions
              </FieldLabel>
              <Textarea
                id="account-new-role-perms"
                value={newRolePerms}
                onChange={(e) => setNewRolePerms(e.target.value)}
                rows={3}
                placeholder="auth.session.read, files.read, email.read"
                disabled={disabled}
              />
              <FieldDescription>
                Comma- or newline-separated permission identifiers.
              </FieldDescription>
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
        open={editingRole !== null}
        onOpenChange={(open) => {
          if (!open) setEditingRole(null);
        }}
      >
        <DialogContent>
          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Update role: {editingRole?.role}</DialogTitle>
              <DialogDescription>
                Edit the permissions granted to this role.
              </DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="account-edit-role-perms">
                Permissions
              </FieldLabel>
              <Textarea
                id="account-edit-role-perms"
                value={editPerms}
                onChange={(e) => setEditPerms(e.target.value)}
                rows={4}
                disabled={disabled}
              />
              <FieldDescription>
                Comma- or newline-separated permission identifiers.
              </FieldDescription>
            </Field>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => setEditingRole(null)}
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
        open={deletingRole !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingRole(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete role &ldquo;{deletingRole}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes all permission grants for this role.
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

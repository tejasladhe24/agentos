import { useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  ArrowsDownUpIcon,
  CheckCircleIcon,
  DotsThreeIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import {
  isFieldInvalid,
  toFieldErrors,
} from '@agentos/core/client/lib/form-errors';
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

import type { AccountRoleEntry } from '../lib/account-types';

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

const DEFAULT_NEW_ROLE_PERMS = 'auth.session.read, files.read, email.read';

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

const createRoleSchema = z.object({
  name: z.string().trim().min(1, 'Role name is required'),
  permissions: z
    .string()
    .refine(
      (raw) => parsePermissionsInput(raw).length > 0,
      'At least one permission is required',
    ),
});

const editRoleSchema = z.object({
  permissions: z.string(),
});

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
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingRole, setEditingRole] = useState<AccountRoleEntry | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingRole, setDeletingRole] = useState<string | null>(null);

  const createForm = useForm({
    defaultValues: { name: '', permissions: DEFAULT_NEW_ROLE_PERMS },
    validators: { onSubmit: createRoleSchema },
    onSubmit: async ({ value }) => {
      if (!onSaveRole) return;
      setCreateError(null);
      try {
        await onSaveRole(
          value.name.trim(),
          parsePermissionsInput(value.permissions),
        );
        setCreateOpen(false);
        createForm.reset({ name: '', permissions: DEFAULT_NEW_ROLE_PERMS });
      } catch (err) {
        setCreateError(
          err instanceof Error ? err.message : 'Create role failed',
        );
      }
    },
  });

  const editForm = useForm({
    defaultValues: { permissions: '' },
    validators: { onSubmit: editRoleSchema },
    onSubmit: async ({ value }) => {
      if (!editingRole || !onSaveRole) return;
      setEditError(null);
      try {
        await onSaveRole(
          editingRole.role,
          parsePermissionsInput(value.permissions),
        );
        setEditingRole(null);
        editForm.reset({ permissions: '' });
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'Update role failed');
      }
    },
  });

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
              setCreateError(null);
              createForm.reset({
                name: '',
                permissions: DEFAULT_NEW_ROLE_PERMS,
              });
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
                                        setEditError(null);
                                        setEditingRole(entry);
                                        editForm.reset({
                                          permissions:
                                            entry.permissions.join(', '),
                                        });
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

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            setCreateError(null);
            createForm.reset({ name: '', permissions: DEFAULT_NEW_ROLE_PERMS });
          }
        }}
      >
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void createForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Create role</DialogTitle>
              <DialogDescription>
                Define a role name and comma-separated permissions.
              </DialogDescription>
            </DialogHeader>
            <createForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => {
                const formDisabled = disabled || isSubmitting;
                return (
                  <>
                    <createForm.Field name="name">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="account-new-role-name">
                              Role name
                            </FieldLabel>
                            <Input
                              id="account-new-role-name"
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => {
                                field.handleChange(e.target.value);
                                if (createError) setCreateError(null);
                              }}
                              placeholder="analyst"
                              disabled={formDisabled}
                              aria-invalid={invalid || undefined}
                              autoFocus
                            />
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </createForm.Field>
                    <createForm.Field name="permissions">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="account-new-role-perms">
                              Permissions
                            </FieldLabel>
                            <Textarea
                              id="account-new-role-perms"
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => {
                                field.handleChange(e.target.value);
                                if (createError) setCreateError(null);
                              }}
                              rows={3}
                              placeholder="auth.session.read, files.read, email.read"
                              disabled={formDisabled}
                              aria-invalid={invalid || undefined}
                            />
                            <FieldDescription>
                              Comma- or newline-separated permission
                              identifiers.
                            </FieldDescription>
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </createForm.Field>
                    {createError ? (
                      <FieldError>{createError}</FieldError>
                    ) : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={formDisabled}
                        onClick={() => setCreateOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={formDisabled}>
                        {isSubmitting ? 'Creating…' : 'Create'}
                      </Button>
                    </DialogFooter>
                  </>
                );
              }}
            </createForm.Subscribe>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={editingRole !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingRole(null);
            setEditError(null);
          }
        }}
      >
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void editForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Update role: {editingRole?.role}</DialogTitle>
              <DialogDescription>
                Edit the permissions granted to this role.
              </DialogDescription>
            </DialogHeader>
            <editForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => {
                const formDisabled = disabled || isSubmitting;
                return (
                  <>
                    <editForm.Field name="permissions">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="account-edit-role-perms">
                              Permissions
                            </FieldLabel>
                            <Textarea
                              id="account-edit-role-perms"
                              name={field.name}
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => {
                                field.handleChange(e.target.value);
                                if (editError) setEditError(null);
                              }}
                              rows={4}
                              disabled={formDisabled}
                              aria-invalid={invalid || undefined}
                            />
                            <FieldDescription>
                              Comma- or newline-separated permission
                              identifiers.
                            </FieldDescription>
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </editForm.Field>
                    {editError ? <FieldError>{editError}</FieldError> : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={formDisabled}
                        onClick={() => setEditingRole(null)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={formDisabled}>
                        {isSubmitting ? 'Saving…' : 'Save'}
                      </Button>
                    </DialogFooter>
                  </>
                );
              }}
            </editForm.Subscribe>
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

import { useMemo, useState } from 'react';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  ArrowsDownUpIcon,
  DotsThreeIcon,
  EnvelopeSimpleIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  UserCircleIcon,
  UserPlusIcon,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agentos/ui/components/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import type { AccountOrgInvite, AccountOrgMember } from '../lib/account-types';

const inviteMemberSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  role: z.string().min(1, 'Role is required'),
});

const changeMemberRoleSchema = z.object({
  role: z.string().min(1, 'Role is required'),
});

export type AccountMembersSectionProps = {
  members: AccountOrgMember[];
  invites?: AccountOrgInvite[];
  currentUserId?: string;
  availableRoles: string[];
  isAdmin?: boolean;
  busy?: boolean;
  onInviteMember?: (input: { email: string; role: string }) => Promise<void>;
  onRevokeInvite?: (inviteId: string) => Promise<void>;
  onChangeMemberRole?: (userId: string, role: string) => Promise<void>;
  onRemoveMember?: (userId: string) => Promise<void>;
};

export function AccountMembersSection({
  members,
  invites = [],
  currentUserId,
  availableRoles,
  isAdmin = false,
  busy = false,
  onInviteMember,
  onRevokeInvite,
  onChangeMemberRole,
  onRemoveMember,
}: AccountMembersSectionProps) {
  const [localError, setLocalError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'active' | 'invited'
  >('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [sortBy, setSortBy] = useState<
    'name-asc' | 'name-desc' | 'email-asc' | 'role-asc'
  >('name-asc');

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [roleMember, setRoleMember] = useState<AccountOrgMember | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  const [removingMember, setRemovingMember] = useState<AccountOrgMember | null>(
    null,
  );
  const [revokingInvite, setRevokingInvite] = useState<AccountOrgInvite | null>(
    null,
  );

  const disabled = busy || pending;
  const roleItems = availableRoles.map((role) => ({
    value: role,
    label: role,
  }));
  const defaultInviteRole = availableRoles.includes('viewer')
    ? 'viewer'
    : (availableRoles[0] ?? 'viewer');

  const inviteForm = useForm({
    defaultValues: { email: '', role: defaultInviteRole },
    validators: { onSubmit: inviteMemberSchema },
    onSubmit: async ({ value }) => {
      if (!onInviteMember) return;
      setInviteError(null);
      try {
        await onInviteMember({
          email: value.email.trim(),
          role: value.role || defaultInviteRole,
        });
        inviteForm.reset({ email: '', role: defaultInviteRole });
        setInviteOpen(false);
      } catch (err) {
        setInviteError(
          err instanceof Error ? err.message : 'Invite member failed',
        );
      }
    },
  });

  const roleForm = useForm({
    defaultValues: { role: '' },
    validators: { onSubmit: changeMemberRoleSchema },
    onSubmit: async ({ value }) => {
      if (!roleMember || !onChangeMemberRole) return;
      setRoleError(null);
      try {
        await onChangeMemberRole(roleMember.userId, value.role);
        setRoleMember(null);
      } catch (err) {
        setRoleError(
          err instanceof Error ? err.message : 'Change member role failed',
        );
      }
    },
  });
  const filterRoles = useMemo(
    () =>
      [
        ...new Set([
          ...availableRoles,
          ...members.map((m) => m.role),
          ...invites.map((i) => i.role),
        ]),
      ].sort(),
    [availableRoles, members, invites],
  );
  const hasFilter = statusFilter !== 'all' || roleFilter !== 'all';

  const filteredMembers = useMemo(() => {
    if (statusFilter === 'invited') return [];
    const q = searchQuery.trim().toLowerCase();
    const list = members.filter((m) => {
      if (roleFilter !== 'all' && m.role !== roleFilter) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'name-desc') return b.name.localeCompare(a.name);
      if (sortBy === 'email-asc') return a.email.localeCompare(b.email);
      if (sortBy === 'role-asc') {
        return a.role.localeCompare(b.role) || a.name.localeCompare(b.name);
      }
      return a.name.localeCompare(b.name);
    });
  }, [members, searchQuery, statusFilter, roleFilter, sortBy]);

  const filteredInvites = useMemo(() => {
    if (statusFilter === 'active') return [];
    const q = searchQuery.trim().toLowerCase();
    const list = invites.filter((inv) => {
      if (roleFilter !== 'all' && inv.role !== roleFilter) return false;
      if (!q) return true;
      return (
        inv.email.toLowerCase().includes(q) ||
        inv.role.toLowerCase().includes(q)
      );
    });
    return [...list].sort((a, b) => {
      if (sortBy === 'name-desc') return b.email.localeCompare(a.email);
      if (sortBy === 'role-asc') {
        return a.role.localeCompare(b.role) || a.email.localeCompare(b.email);
      }
      return a.email.localeCompare(b.email);
    });
  }, [invites, searchQuery, statusFilter, roleFilter, sortBy]);

  async function handleRemove() {
    if (!removingMember || !onRemoveMember) return;
    setPending(true);
    setLocalError(null);
    try {
      await onRemoveMember(removingMember.userId);
      setRemovingMember(null);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Remove member failed',
      );
    } finally {
      setPending(false);
    }
  }

  async function handleRevokeInvite() {
    if (!revokingInvite || !onRevokeInvite) return;
    setPending(true);
    setLocalError(null);
    try {
      await onRevokeInvite(revokingInvite.id);
      setRevokingInvite(null);
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : 'Revoke invite failed',
      );
    } finally {
      setPending(false);
    }
  }

  const hasAnyRows = members.length > 0 || invites.length > 0;
  const hasFilteredRows =
    filteredMembers.length > 0 || filteredInvites.length > 0;

  return (
    <FieldSet data-slot="account-members" data-setting-entry="members">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <FieldLegend>Members</FieldLegend>
          <FieldDescription>
            Members of the active organization and their assigned roles.
          </FieldDescription>
        </div>
        {isAdmin && onInviteMember ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled}
            data-slot="invite-member-trigger"
            onClick={() => {
              setLocalError(null);
              setInviteError(null);
              inviteForm.reset({ email: '', role: defaultInviteRole });
              setInviteOpen(true);
            }}
          >
            <UserPlusIcon className="size-3.5" aria-hidden />
            Invite member
          </Button>
        ) : null}
      </div>

      {localError ? <FieldError>{localError}</FieldError> : null}

      <FieldGroup>
        {!hasAnyRows ? (
          <FieldDescription>No members found.</FieldDescription>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <InputGroup className="max-w-xs">
                <InputGroupInput
                  placeholder="Search members…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  aria-label="Search members"
                  data-slot="members-search"
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
                        aria-label="Filter members"
                        data-slot="members-filter"
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
                      <DropdownMenuLabel>Status</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={statusFilter}
                        onValueChange={(v) =>
                          setStatusFilter(v as 'all' | 'active' | 'invited')
                        }
                      >
                        <DropdownMenuRadioItem value="all">
                          All
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="active">
                          Active members
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="invited">
                          Pending invites
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Role</DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={roleFilter}
                        onValueChange={setRoleFilter}
                      >
                        <DropdownMenuRadioItem value="all">
                          All roles
                        </DropdownMenuRadioItem>
                        {filterRoles.map((role) => (
                          <DropdownMenuRadioItem key={role} value={role}>
                            {role}
                          </DropdownMenuRadioItem>
                        ))}
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
                        aria-label="Sort members"
                        data-slot="members-sort"
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
                              | 'email-asc'
                              | 'role-asc',
                          )
                        }
                      >
                        <DropdownMenuRadioItem value="name-asc">
                          Name (A → Z)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="name-desc">
                          Name (Z → A)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="email-asc">
                          Email (A → Z)
                        </DropdownMenuRadioItem>
                        <DropdownMenuRadioItem value="role-asc">
                          Role (A → Z)
                        </DropdownMenuRadioItem>
                      </DropdownMenuRadioGroup>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
            </div>
            <div className="rounded-none border border-border">
              <Table data-slot="members-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Role</TableHead>
                    {isAdmin ? <TableHead className="w-12 text-right" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!hasFilteredRows ? (
                    <TableRow>
                      <TableCell
                        colSpan={isAdmin ? 3 : 2}
                        className="py-6 text-center text-muted-foreground"
                      >
                        No matching members.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {filteredMembers.map((member) => {
                        const isSelf = member.userId === currentUserId;
                        return (
                          <TableRow
                            key={member.userId}
                            data-member-id={member.userId}
                            data-state={isSelf ? 'selected' : undefined}
                          >
                            <TableCell>
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2 font-medium">
                                  <span>{member.name}</span>
                                  {isSelf ? (
                                    <UserCircleIcon
                                      weight="fill"
                                      className="size-3.5 shrink-0 text-primary"
                                      aria-label="You"
                                    />
                                  ) : null}
                                </div>
                                <span className="text-muted-foreground">
                                  {member.email}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{member.role}</Badge>
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
                                        aria-label={`Actions for ${member.email}`}
                                        data-slot="member-row-actions"
                                      />
                                    }
                                  >
                                    <DotsThreeIcon className="size-4" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    {onChangeMemberRole ? (
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setLocalError(null);
                                          setRoleError(null);
                                          setRoleMember(member);
                                          roleForm.reset({ role: member.role });
                                        }}
                                      >
                                        Change role
                                      </DropdownMenuItem>
                                    ) : null}
                                    {onRemoveMember ? (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          variant="destructive"
                                          disabled={isSelf}
                                          onClick={() => {
                                            setLocalError(null);
                                            setRemovingMember(member);
                                          }}
                                        >
                                          Remove from organization
                                        </DropdownMenuItem>
                                      </>
                                    ) : null}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                      {filteredInvites.map((invite) => (
                        <TableRow
                          key={`invite:${invite.id}`}
                          data-invite-id={invite.id}
                        >
                          <TableCell>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2 font-medium">
                                <span>{invite.email}</span>
                                <EnvelopeSimpleIcon
                                  className="size-3.5 shrink-0 text-muted-foreground"
                                  aria-label="Pending invite"
                                />
                              </div>
                              <span className="text-muted-foreground">
                                Pending invite
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{invite.role}</Badge>
                          </TableCell>
                          {isAdmin ? (
                            <TableCell className="text-right">
                              {onRevokeInvite ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-sm"
                                        disabled={disabled}
                                        aria-label={`Actions for invite ${invite.email}`}
                                        data-slot="invite-row-actions"
                                      />
                                    }
                                  >
                                    <DotsThreeIcon className="size-4" />
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => {
                                        setLocalError(null);
                                        setRevokingInvite(invite);
                                      }}
                                    >
                                      Revoke invite
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </TableCell>
                          ) : null}
                        </TableRow>
                      ))}
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </FieldGroup>

      <Dialog
        open={inviteOpen}
        onOpenChange={(open) => {
          setInviteOpen(open);
          if (!open) {
            setInviteError(null);
            inviteForm.reset({ email: '', role: defaultInviteRole });
          }
        }}
      >
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void inviteForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Invite member</DialogTitle>
              <DialogDescription>
                Add an existing user immediately or create a pending invite for
                when they sign up.
              </DialogDescription>
            </DialogHeader>
            <inviteForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => {
                const formDisabled = disabled || isSubmitting;
                return (
                  <>
                    <inviteForm.Field name="email">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="account-invite-email">
                              Email
                            </FieldLabel>
                            <Input
                              id="account-invite-email"
                              name={field.name}
                              type="email"
                              value={field.state.value}
                              onBlur={field.handleBlur}
                              onChange={(e) => {
                                field.handleChange(e.target.value);
                                if (inviteError) setInviteError(null);
                              }}
                              placeholder="teammate@acme.com"
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
                    </inviteForm.Field>
                    <inviteForm.Field name="role">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="account-invite-role">
                              Role
                            </FieldLabel>
                            <Select
                              items={roleItems}
                              value={field.state.value || defaultInviteRole}
                              onValueChange={(val) => {
                                if (typeof val === 'string') {
                                  field.handleChange(val);
                                  if (inviteError) setInviteError(null);
                                }
                              }}
                              disabled={formDisabled}
                            >
                              <SelectTrigger
                                id="account-invite-role"
                                className="w-full"
                                aria-invalid={invalid || undefined}
                              >
                                <SelectValue placeholder="Choose a role" />
                              </SelectTrigger>
                              <SelectContent>
                                {roleItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </inviteForm.Field>
                    {inviteError ? (
                      <FieldError>{inviteError}</FieldError>
                    ) : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={formDisabled}
                        onClick={() => setInviteOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button type="submit" size="sm" disabled={formDisabled}>
                        {isSubmitting ? 'Inviting…' : 'Invite'}
                      </Button>
                    </DialogFooter>
                  </>
                );
              }}
            </inviteForm.Subscribe>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={roleMember !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRoleMember(null);
            setRoleError(null);
          }
        }}
      >
        <DialogContent>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void roleForm.handleSubmit();
            }}
            className="flex flex-col gap-4"
          >
            <DialogHeader>
              <DialogTitle>Change member role</DialogTitle>
              <DialogDescription>
                Select a new role for {roleMember?.name} ({roleMember?.email}).
              </DialogDescription>
            </DialogHeader>
            <roleForm.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => {
                const formDisabled = disabled || isSubmitting;
                return (
                  <>
                    <roleForm.Field name="role">
                      {(field) => {
                        const invalid = isFieldInvalid(field.state.meta);
                        return (
                          <Field data-invalid={invalid || undefined}>
                            <FieldLabel htmlFor="account-member-role">
                              Role
                            </FieldLabel>
                            <Select
                              items={roleItems}
                              value={field.state.value || null}
                              onValueChange={(val) => {
                                if (typeof val === 'string') {
                                  field.handleChange(val);
                                  if (roleError) setRoleError(null);
                                }
                              }}
                              disabled={formDisabled}
                            >
                              <SelectTrigger
                                id="account-member-role"
                                className="w-full"
                                aria-invalid={invalid || undefined}
                              >
                                <SelectValue placeholder="Choose a role" />
                              </SelectTrigger>
                              <SelectContent>
                                {roleItems.map((item) => (
                                  <SelectItem
                                    key={item.value}
                                    value={item.value}
                                  >
                                    {item.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {invalid ? (
                              <FieldError
                                errors={toFieldErrors(field.state.meta.errors)}
                              />
                            ) : null}
                          </Field>
                        );
                      }}
                    </roleForm.Field>
                    {roleError ? <FieldError>{roleError}</FieldError> : null}
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={formDisabled}
                        onClick={() => setRoleMember(null)}
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
            </roleForm.Subscribe>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removingMember !== null}
        onOpenChange={(open) => {
          if (!open) setRemovingMember(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removingMember?.name} from organization?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removingMember?.email} will lose access to this organization and
              their personal secrets in this workspace will be purged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabled}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={() => void handleRemove()}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={revokingInvite !== null}
        onOpenChange={(open) => {
          if (!open) setRevokingInvite(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke invite for {revokingInvite?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They will no longer be automatically added when they sign up.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disabled}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={disabled}
              onClick={() => void handleRevokeInvite()}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldSet>
  );
}

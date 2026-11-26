export type AccountOrgMembership = {
  id: string;
  name: string;
  role: string;
};

export type AccountRoleEntry = {
  role: string;
  permissions: string[];
};

export type AccountOrgMember = {
  userId: string;
  email: string;
  name: string;
  role: string;
};

export type AccountOrgInvite = {
  id: string;
  orgId: string;
  email: string;
  role: string;
  invitedBy: string;
  createdAt: string;
};

export type AccountSessionView = {
  user: { id: string; email: string; name: string } | null;
  roles: string[];
  orgId: string | null;
  orgs: AccountOrgMembership[];
};

const ADMIN_ROLES = new Set(['admin', 'owner']);

export function isAdminSessionRoles(roles: readonly string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.has(role));
}

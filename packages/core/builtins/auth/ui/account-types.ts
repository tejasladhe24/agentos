export type AccountOrgMembership = {
  id: string;
  name: string;
  role: string;
};

export type AccountSessionView = {
  user: { id: string; email: string; name: string } | null;
  roles: string[];
  orgId: string | null;
  orgs: AccountOrgMembership[];
};

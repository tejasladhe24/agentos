/** Same-origin gateway path for the auth builtin. */
export const AUTH_API_BASE = '/api/ext/auth';

export type AuthOrgMembership = {
  id: string;
  name: string;
  role: string;
};

export type AuthSessionView = {
  user: { id: string; email: string; name: string } | null;
  roles: string[];
  orgId?: string | null;
  orgs?: AuthOrgMembership[];
};

export type AuthSessionOk = {
  user: { id: string; email: string; name: string };
  roles: string[];
  orgId: string | null;
  orgs: AuthOrgMembership[];
};

async function parseError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    if (body.error) return body.error;
    if (body.message) return body.message;
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

/** GET /session — null when unauthenticated. */
export async function fetchAuthSession(): Promise<AuthSessionOk | null> {
  const res = await fetch(`${AUTH_API_BASE}/session`, {
    credentials: 'include',
  });
  if (res.status === 401) return null;
  if (!res.ok) {
    throw new Error(await parseError(res));
  }
  const data = (await res.json()) as AuthSessionView;
  if (!data.user) return null;
  return {
    user: data.user,
    roles: data.roles ?? [],
    orgId: data.orgId ?? null,
    orgs: data.orgs ?? [],
  };
}

export async function signInWithEmail(
  email: string,
  password: string,
): Promise<AuthSessionOk> {
  const res = await fetch(`${AUTH_API_BASE}/sign-in`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as AuthSessionView;
  if (!data.user) throw new Error('Sign-in succeeded but no user');
  return {
    user: data.user,
    roles: data.roles ?? [],
    orgId: data.orgId ?? null,
    orgs: data.orgs ?? [],
  };
}

export async function signUpWithEmail(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthSessionOk> {
  const res = await fetch(`${AUTH_API_BASE}/sign-up`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(await parseError(res));
  const data = (await res.json()) as AuthSessionView;
  if (!data.user) throw new Error('Sign-up succeeded but no user');
  return {
    user: data.user,
    roles: data.roles ?? [],
    orgId: data.orgId ?? null,
    orgs: data.orgs ?? [],
  };
}

function sessionFromView(data: AuthSessionView): AuthSessionOk {
  if (!data.user) throw new Error('Expected authenticated session');
  return {
    user: data.user,
    roles: data.roles ?? [],
    orgId: data.orgId ?? null,
    orgs: data.orgs ?? [],
  };
}

/** POST /orgs — create org; creator becomes owner and active org switches. */
export async function createOrganization(name: string): Promise<AuthSessionOk> {
  const res = await fetch(`${AUTH_API_BASE}/orgs`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return sessionFromView((await res.json()) as AuthSessionView);
}

/** POST /orgs/switch — set active org (must be a member). */
export async function switchOrganization(
  orgId: string,
): Promise<AuthSessionOk> {
  const res = await fetch(`${AUTH_API_BASE}/orgs/switch`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) throw new Error(await parseError(res));
  return sessionFromView((await res.json()) as AuthSessionView);
}

export async function requestPasswordReset(email: string): Promise<void> {
  const redirectTo = `${window.location.origin}/reset-password`;
  const res = await fetch(`${AUTH_API_BASE}/forgot-password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, redirectTo }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${AUTH_API_BASE}/reset-password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) throw new Error(await parseError(res));
}

export async function signOutSession(): Promise<void> {
  await fetch(`${AUTH_API_BASE}/sign-out`, {
    method: 'POST',
    credentials: 'include',
  });
}

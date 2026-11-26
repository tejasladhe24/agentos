/**
 * Gateway path for another extension's API, for `useHostApi().fetch`.
 *
 * The Shell only forwards it when the target is the calling extension or is
 * listed in the caller's `meta.json` `dependsOn`; otherwise `fetch` resolves
 * with status 403. Prefer a host capability (`useHostAuth`, `useHostFiles`,
 * `useHostNotifications().send`, …) when one exists.
 */
export function extensionPath(extensionId: string, path = ''): string {
  const normalized = path === '' || path.startsWith('/') ? path : `/${path}`;
  return `/api/ext/${encodeURIComponent(extensionId)}${normalized}`;
}

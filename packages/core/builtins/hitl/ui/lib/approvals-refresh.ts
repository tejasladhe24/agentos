/**
 * The Approvals list refreshes on `hitl.requested` / `hitl.resolved` bus
 * events. This slow poll is only a safety net for events that never reach the
 * browser (org-less service callers, SSE unavailable).
 */
export const APPROVALS_FALLBACK_POLL_MS = 30_000;

/** Topics that mean the approvals list changed (declared in `meta.json`). */
export const APPROVALS_CHANGED_TOPICS = [
  'hitl.requested',
  'hitl.resolved',
] as const;

export type VisibilityTarget = {
  readonly hidden: boolean;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
};

/**
 * Runs `load` on a slow interval while the page is visible, and once more when
 * it becomes visible again. Returns a cleanup function.
 */
export function startFallbackRefresh(
  load: () => void,
  options: {
    pollMs?: number;
    doc?: VisibilityTarget | null;
  } = {},
): () => void {
  const pollMs = options.pollMs ?? APPROVALS_FALLBACK_POLL_MS;
  const doc =
    options.doc === undefined
      ? typeof document === 'undefined'
        ? null
        : document
      : options.doc;

  const timer = setInterval(() => {
    if (doc?.hidden) return;
    load();
  }, pollMs);
  const onVisible = () => {
    if (!doc?.hidden) load();
  };
  doc?.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener('visibilitychange', onVisible);
  };
}

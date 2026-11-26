import { describe, expect, test } from 'bun:test';

import {
  APPROVALS_CHANGED_TOPICS,
  APPROVALS_FALLBACK_POLL_MS,
  startFallbackRefresh,
  type VisibilityTarget,
} from '@agentos/core/builtins/hitl/ui/lib/approvals-refresh';
import meta from '@agentos/core/builtins/hitl/meta.json';

function fakeDoc(hidden = false) {
  const listeners = new Set<() => void>();
  const doc: VisibilityTarget & { hidden: boolean; show: () => void } = {
    hidden,
    addEventListener: (_t, l) => void listeners.add(l),
    removeEventListener: (_t, l) => void listeners.delete(l),
    show() {
      doc.hidden = false;
      for (const l of [...listeners]) l();
    },
  };
  return { doc, listeners };
}

describe('approvals refresh', () => {
  test('the fallback poll is slow (no more 3 s list polling)', () => {
    expect(APPROVALS_FALLBACK_POLL_MS).toBeGreaterThanOrEqual(30_000);
  });

  test('hitl declares every topic the page subscribes to', () => {
    expect([...(APPROVALS_CHANGED_TOPICS as readonly string[])].sort()).toEqual(
      [...meta.events.subscribes].sort(),
    );
  });

  test('polls while visible, pauses while hidden, reloads on becoming visible', async () => {
    const { doc, listeners } = fakeDoc(false);
    let loads = 0;
    const stop = startFallbackRefresh(() => (loads += 1), {
      pollMs: 10,
      doc,
    });
    await new Promise((r) => setTimeout(r, 35));
    expect(loads).toBeGreaterThanOrEqual(2);

    doc.hidden = true;
    const paused = loads;
    await new Promise((r) => setTimeout(r, 35));
    expect(loads).toBe(paused);

    doc.show();
    expect(loads).toBe(paused + 1);

    stop();
    expect(listeners.size).toBe(0);
    const after = loads;
    await new Promise((r) => setTimeout(r, 30));
    expect(loads).toBe(after);
  });
});

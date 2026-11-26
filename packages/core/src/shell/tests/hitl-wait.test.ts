import { describe, expect, test } from 'bun:test';
import {
  waitForApproval,
  type ApprovalStatus,
  type WaitForApprovalDeps,
} from '@agentos/core/shell/lib';

type Harness = {
  deps: WaitForApprovalDeps;
  fetches: () => number;
  fire: (approvalId: string, decision: string) => void;
  listening: () => number;
  setStatus: (status: ApprovalStatus | null) => void;
};

function harness(
  overrides: Partial<WaitForApprovalDeps> = {},
  initial: ApprovalStatus | null = 'pending',
): Harness {
  let status = initial;
  let fetchCount = 0;
  const listeners = new Set<
    (event: { approvalId: string; decision: string }) => void
  >();
  return {
    deps: {
      fetchStatus: async () => {
        fetchCount += 1;
        return status;
      },
      listenResolved: (onResolved) => {
        listeners.add(onResolved);
        return () => listeners.delete(onResolved);
      },
      pollMs: 10_000,
      timeoutMs: 60_000,
      ...overrides,
    },
    fetches: () => fetchCount,
    fire: (approvalId, decision) => {
      for (const listener of [...listeners]) listener({ approvalId, decision });
    },
    listening: () => listeners.size,
    setStatus: (next) => {
      status = next;
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('waitForApproval', () => {
  test('resolves from the hitl.resolved event without polling', async () => {
    const h = harness();
    const pending = waitForApproval('a1', h.deps);
    await tick();
    // Only the single immediate check ran; no 250 ms-style polling loop.
    expect(h.fetches()).toBe(1);
    h.fire('someone-else', 'approved');
    h.fire('a1', 'rejected');
    expect(await pending).toEqual({ approved: false, id: 'a1' });
    expect(h.listening()).toBe(0);
    expect(h.fetches()).toBe(1);
  });

  test('catches a decision that landed before the listener attached', async () => {
    const h = harness({}, 'approved');
    expect(await waitForApproval('a1', h.deps)).toEqual({
      approved: true,
      id: 'a1',
    });
    expect(h.listening()).toBe(0);
  });

  test('falls back to a slow single-record poll when no event arrives', async () => {
    const h = harness({ pollMs: 15 });
    const pending = waitForApproval('a1', h.deps);
    await tick();
    h.setStatus('approved');
    expect(await pending).toEqual({ approved: true, id: 'a1' });
    expect(h.fetches()).toBeGreaterThanOrEqual(2);
    expect(h.listening()).toBe(0);
  });

  test('the fallback poll is slow, not a tight loop', async () => {
    const h = harness({ pollMs: 40 });
    const pending = waitForApproval('a1', h.deps);
    await new Promise((r) => setTimeout(r, 100));
    // 1 immediate + ~2 polls in 100 ms; a 250 ms-style loop would be far higher
    // and a 1 ms loop would be ~100.
    expect(h.fetches()).toBeLessThan(6);
    h.fire('a1', 'approved');
    await pending;
  });

  test('transient fetch failures are retried, not fatal', async () => {
    let calls = 0;
    const h = harness({
      pollMs: 10,
      fetchStatus: async () => {
        calls += 1;
        if (calls < 3) throw new Error('network');
        return 'approved';
      },
    });
    expect(await waitForApproval('a1', h.deps)).toEqual({
      approved: true,
      id: 'a1',
    });
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  test('times out and cleans up', async () => {
    const h = harness({ timeoutMs: 30, pollMs: 10 });
    await expect(waitForApproval('a1', h.deps)).rejects.toThrow(
      'HITL approval timed out for a1',
    );
    expect(h.listening()).toBe(0);
    const after = h.fetches();
    await new Promise((r) => setTimeout(r, 40));
    expect(h.fetches()).toBe(after); // poll stopped
  });

  test('an unknown event decision re-checks the authoritative record', async () => {
    const h = harness();
    const pending = waitForApproval('a1', h.deps);
    await tick();
    h.setStatus('approved');
    h.fire('a1', 'weird');
    expect(await pending).toEqual({ approved: true, id: 'a1' });
  });
});

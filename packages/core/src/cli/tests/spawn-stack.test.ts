import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BUILTIN_SERVERS } from '../lib/builtin-servers';
import type { ChildSpec, ProcessManager } from '../lib/process-manager';
import { spawnAgentOsStack } from '../lib/spawn-stack';

describe('spawnAgentOsStack', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  test('builtins get direct peer bases instead of the gateway fallback', () => {
    dir = mkdtempSync(join(tmpdir(), 'agentos-spawn-stack-'));
    const specs: ChildSpec[] = [];
    const pm = { spawn: (spec: ChildSpec) => specs.push(spec) };

    spawnAgentOsStack({
      consumerRoot: dir,
      extensionsDir: dir,
      gatewayUrl: 'http://127.0.0.1:5173',
      pm: pm as unknown as ProcessManager,
    });

    const builtins = specs.filter((s) =>
      BUILTIN_SERVERS.some((b) => b.name === s.name),
    );
    expect(builtins).toHaveLength(BUILTIN_SERVERS.length);
    for (const spec of builtins) {
      expect(spec.env).toMatchObject({
        AGENT_OS_DB_STORE_API_BASE: 'http://127.0.0.1:6111',
        AGENT_OS_SECRETS_API_BASE: 'http://127.0.0.1:6118',
        AGENT_OS_GLOBAL_GATEWAY_URL: 'http://127.0.0.1:5173',
      });
    }
  });
});

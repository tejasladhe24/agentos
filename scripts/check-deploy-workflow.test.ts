import { describe, expect, test } from 'bun:test';

import {
  checkDeployWorkflowCommands,
  checkRepoDeployWorkflow,
  extractPnpmCommands,
} from './check-deploy-workflow';

const scripts = {
  ci: 'turbo run …',
  'deploy:cloudflare': 'pnpm --filter …',
  'deploy:cloudflare:dev': 'pnpm --filter …',
};

describe('extractPnpmCommands', () => {
  test('reads single-line and block run steps', () => {
    const yaml = `
jobs:
  deploy:
    steps:
      - run: pnpm install --frozen-lockfile
      - name: CI
        run: pnpm run ci
      - run: |
          if [ "$x" = "dev" ]; then
            pnpm run deploy:cloudflare:dev
          else
            pnpm run deploy:cloudflare
          fi
`;
    expect(extractPnpmCommands(yaml)).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm run ci',
      'pnpm run deploy:cloudflare:dev',
      'pnpm run deploy:cloudflare',
    ]);
  });
});

describe('checkDeployWorkflowCommands', () => {
  test('accepts pnpm run scripts and install', () => {
    const yaml = `
      - run: pnpm install --frozen-lockfile
      - run: pnpm run ci
      - run: pnpm run deploy:cloudflare
`;
    expect(checkDeployWorkflowCommands(yaml, scripts)).toEqual([]);
  });

  test('rejects bare pnpm ci (pnpm builtin shadow)', () => {
    const issues = checkDeployWorkflowCommands('- run: pnpm ci\n', scripts);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.command).toBe('pnpm ci');
    expect(issues[0]?.message).toContain('pnpm run ci');
  });

  test('rejects bare script shorthand', () => {
    const issues = checkDeployWorkflowCommands(
      '- run: pnpm deploy:cloudflare\n',
      scripts,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).toContain('pnpm run deploy:cloudflare');
  });

  test('rejects unknown pnpm run script', () => {
    const issues = checkDeployWorkflowCommands(
      '- run: pnpm run does-not-exist\n',
      scripts,
    );
    expect(issues[0]?.message).toContain('unknown root package script');
  });
});

describe('checkRepoDeployWorkflow', () => {
  test('live deploy-cloudflare.yml passes against root package.json', () => {
    expect(checkRepoDeployWorkflow()).toEqual([]);
  });
});

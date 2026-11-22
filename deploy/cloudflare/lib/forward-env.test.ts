import { describe, expect, test } from 'bun:test';

import { collectContainerEnv } from './forward-env';

describe('collectContainerEnv', () => {
  test('applies production defaults and skips empty values', () => {
    const env = collectContainerEnv({
      AGENT_OS_GLOBAL_APP_ORIGIN: 'https://app.example.com',
      AGENT_OS_EXT_AUTH_SECRET: 'x'.repeat(32),
      AGENT_OS_EXT_AUTH_DB: '',
      AGENT_OS_EXT_FILES_S3_BUCKET: 'agentos-files',
    });

    expect(env.PORT).toBe('8080');
    expect(env.NODE_ENV).toBe('production');
    expect(env.AGENT_OS_GLOBAL_NODE_ENV).toBe('production');
    expect(env.AGENT_OS_GLOBAL_APP_ORIGIN).toBe('https://app.example.com');
    expect(env.AGENT_OS_EXT_AUTH_SECRET).toBe('x'.repeat(32));
    expect(env.AGENT_OS_EXT_FILES_S3_BUCKET).toBe('agentos-files');
    expect(env).not.toHaveProperty('AGENT_OS_EXT_AUTH_DB');
  });

  test('lets Worker values override defaults', () => {
    const env = collectContainerEnv({
      PORT: '9090',
      NODE_ENV: 'production',
    });
    expect(env.PORT).toBe('9090');
  });
});

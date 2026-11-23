import { createEnv } from '@t3-oss/env-core';
import { platformKeys } from '@agentos/core/api/env';
import { keys as aiKeys } from '@agentos/core/builtins/ai/env';
import { keys as auditKeys } from '@agentos/core/builtins/audit/env';
import { keys as authKeys } from '@agentos/core/builtins/auth/env';
import { keys as cacheStoreKeys } from '@agentos/core/builtins/cache-store/env';
import { keys as dbStoreKeys } from '@agentos/core/builtins/db-store/env';
import { keys as eventsKeys } from '@agentos/core/builtins/events/env';
import { keys as filesKeys } from '@agentos/core/builtins/files/env';
import { keys as hitlKeys } from '@agentos/core/builtins/hitl/env';
import { keys as notificationsKeys } from '@agentos/core/builtins/notifications/env';
import { keys as secretsKeys } from '@agentos/core/builtins/secrets/env';
import { keys as vectorStoreKeys } from '@agentos/core/builtins/vector-store/env';
import { keys as crmHelperKeys } from '@extensions/crm-helper/api/env';
import { keys as demoKeys } from '@extensions/demo/api/env';

/**
 * App-level env: extend platform + builtin + customer `keys()` instances.
 * Import from Bun API entrypoints (not iframe UI).
 */
export const env = createEnv({
  extends: [
    platformKeys(),
    authKeys(),
    dbStoreKeys(),
    cacheStoreKeys(),
    aiKeys(),
    hitlKeys(),
    eventsKeys(),
    filesKeys(),
    notificationsKeys(),
    secretsKeys(),
    auditKeys(),
    vectorStoreKeys(),
    demoKeys(),
    crmHelperKeys(),
  ],
  server: {},
  clientPrefix: 'AGENT_OS_APP_CLIENT',
  client: {},
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});

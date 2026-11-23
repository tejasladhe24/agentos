import { useEffect, useState } from 'react';
import { useHostApi } from '@agentos/core/client';

import { EmailPanel } from './email-panel';
import { useEmailSection } from './use-email-section';

/**
 * Email secondary Activity Bar page — inbox, compose, deliveries, addresses.
 */
export default function EmailManagerPage() {
  const api = useHostApi();
  const [section] = useEmailSection();
  const [canSend, setCanSend] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await api.fetch('/api/ext/auth/permissions/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ permission: 'email.send' }),
      });
      if (cancelled) return;
      if (res.status === 401) {
        setCanSend(false);
        setError('Sign in to use Email.');
        return;
      }
      if (!res.ok) {
        // If auth check is unreachable, keep Compose visible; API still enforces.
        setCanSend(true);
        return;
      }
      try {
        const body = JSON.parse(res.body) as { allowed?: boolean };
        setCanSend(body.allowed === true);
        setError(null);
      } catch {
        setCanSend(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  return <EmailPanel section={section} canSend={canSend} error={error} />;
}

import { useEffect, useState } from 'react';
import { useHostAuth } from '@agentos/core/client';

import { EmailPanel } from './components/email-panel';
import { useEmailSection } from './lib/use-email-section';

/**
 * Email secondary Activity Bar page — inbox, compose, deliveries, addresses.
 */
export default function EmailManagerPage() {
  const auth = useHostAuth();
  const [section] = useEmailSection();
  const [canSend, setCanSend] = useState(true);

  useEffect(() => {
    let cancelled = false;
    auth.can('email.send').then(
      (allowed) => {
        if (!cancelled) setCanSend(allowed);
      },
      () => {
        // If auth is unreachable, keep Compose visible; the API still enforces.
        if (!cancelled) setCanSend(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [auth]);

  return <EmailPanel section={section} canSend={canSend} />;
}

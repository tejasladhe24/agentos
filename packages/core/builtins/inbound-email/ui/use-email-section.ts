import { useCallback, useEffect, useState } from 'react';
import { useHostStorage } from '@agentos/core/client';

import {
  DEFAULT_EMAIL_SECTION,
  EMAIL_SECTION_CHANNEL,
  EMAIL_SECTION_STORAGE_KEY,
  parseEmailSection,
  type EmailSection,
} from './email-section';

/**
 * Shared Email section selection across page + sidebar iframes.
 */
export function useEmailSection(): [
  EmailSection,
  (section: EmailSection) => Promise<void>,
] {
  const storage = useHostStorage();
  const [section, setSection] = useState<EmailSection>(DEFAULT_EMAIL_SECTION);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const stored = await storage.get(EMAIL_SECTION_STORAGE_KEY);
      if (!cancelled) {
        setSection(parseEmailSection(stored));
      }
    })();

    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel(EMAIL_SECTION_CHANNEL)
        : null;

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        setSection(parseEmailSection(event.data));
      };
    }

    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [storage]);

  const selectSection = useCallback(
    async (next: EmailSection) => {
      setSection(next);
      await storage.set(EMAIL_SECTION_STORAGE_KEY, next);
      if (typeof BroadcastChannel !== 'undefined') {
        const channel = new BroadcastChannel(EMAIL_SECTION_CHANNEL);
        channel.postMessage(next);
        channel.close();
      }
    },
    [storage],
  );

  return [section, selectSection];
}

import { useHostSharedState } from '@agentos/core/client';

import {
  DEFAULT_EMAIL_SECTION,
  EMAIL_SECTION_STORAGE_KEY,
  EMAIL_SECTION_TOPIC,
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
  return useHostSharedState<EmailSection>(
    EMAIL_SECTION_STORAGE_KEY,
    DEFAULT_EMAIL_SECTION,
    { topic: EMAIL_SECTION_TOPIC, parse: parseEmailSection },
  );
}

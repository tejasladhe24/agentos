import { useEffect, useState } from 'react';
import {
  extensionPath,
  useHostApi,
  useSettingsTarget,
} from '@agentos/core/client';
import {
  IntegrationSection,
  type IntegrationSectionData,
} from '@agentos/core/client/components/integration-section';
import { FieldGroup, FieldSeparator } from '@agentos/ui/components/field';

import { ReceivingCard } from './receiving-card';
import { UserEmailFromCard } from './user-email-from-card';

const EMAIL_SEND_INTEGRATION_PATH = extensionPath(
  'notifications',
  '/integrations/email.send',
);

/**
 * Email Settings — personal sender address for all users; org provider / API
 * keys (`email.send` + `email.receive`) visible only to admins (`canManage`).
 * Mounted by the Shell Settings host for section `email`.
 */
export default function EmailSettings() {
  useSettingsTarget();
  const api = useHostApi();
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkAccess() {
      const res = await api.fetch(EMAIL_SEND_INTEGRATION_PATH);
      if (cancelled || !res.ok) return;
      try {
        const data = JSON.parse(res.body) as Partial<IntegrationSectionData>;
        setCanManage(data.canManage === true);
      } catch {
        setCanManage(false);
      }
    }
    void checkAccess();
    return () => {
      cancelled = true;
    };
  }, [api]);

  return (
    <div
      className="fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground"
      data-slot="settings-email"
    >
      <FieldGroup className="gap-8">
        <UserEmailFromCard entryId="email-from" />
        {canManage ? (
          <>
            <FieldSeparator />
            <IntegrationSection
              integration="email.send"
              basePath={extensionPath('notifications', '/integrations')}
              entryId="email-sending"
            />
            <FieldSeparator />
            <ReceivingCard entryId="email-receiving" />
          </>
        ) : null}
      </FieldGroup>
    </div>
  );
}

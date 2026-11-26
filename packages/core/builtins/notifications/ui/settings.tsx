import { SettingsPage } from '@agentos/core/client/components/settings-page';
import { useEffect, useState } from 'react';
import { useHostApi, useSettingsTarget } from '@agentos/core/client';
import {
  IntegrationSection,
  type IntegrationSectionData,
} from '@agentos/core/client/components/integration-section';
import { FieldGroup, FieldSeparator } from '@agentos/ui/components/field';

import { SmsDefaultNumberField } from './sms-number-select';
import { UserSmsFromCard } from './user-sms-from-card';
import { useSmsNumbers } from './use-sms-numbers';

const SMS_INTEGRATION_PATH = '/integrations/sms';

/**
 * Notifications Settings — personal SMS sender number for every member; the
 * org's Twilio credentials (BYOK) is shown only to admins (`canManage`). Mounted by
 * the Shell Settings host for section `sms`.
 */
export default function NotificationsSettings() {
  useSettingsTarget();
  const api = useHostApi();
  const numbers = useSmsNumbers();
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function checkAccess() {
      const res = await api.fetch(SMS_INTEGRATION_PATH);
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
    <SettingsPage data-slot="settings-sms">
      <FieldGroup className="gap-8">
        <UserSmsFromCard entryId="sms-from" numbers={numbers} />
        {canManage ? (
          <>
            <FieldSeparator />
            <IntegrationSection
              integration="sms"
              entryId="sms-provider"
              onSaved={() => void numbers.reload()}
              renderSetting={(input) =>
                input.field.name === 'from' ? (
                  <SmsDefaultNumberField input={input} state={numbers} />
                ) : undefined
              }
            />
          </>
        ) : null}
      </FieldGroup>
    </SettingsPage>
  );
}

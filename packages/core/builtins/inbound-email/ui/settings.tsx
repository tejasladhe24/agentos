import { useSettingsTarget } from '@agentos/core/client';
import { IntegrationSection } from '@agentos/core/client/components/integration-section';

/**
 * Email Settings — sending provider (BYOK) card served by builtin
 * `notifications`. Mounted by the Shell Settings host for section `email`.
 */
export default function EmailSettings() {
  useSettingsTarget();
  return (
    <div
      className="fixed inset-0 flex flex-col gap-6 overflow-y-auto bg-background px-6 py-6 text-foreground"
      data-slot="settings-email"
    >
      <IntegrationSection
        integration="email.send"
        basePath="/api/ext/notifications/integrations"
        entryId="email-sending"
      />
    </div>
  );
}

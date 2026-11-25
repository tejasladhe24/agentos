import { useSettingsTarget } from '@agentos/core/client';
import { IntegrationSection } from '@agentos/core/client/components/integration-section';
import { FieldGroup } from '@agentos/ui/components/field';

/**
 * Notifications Settings — SMS provider (BYOK) section. Mounted by the Shell
 * Settings host for section `sms`.
 */
export default function NotificationsSettings() {
  useSettingsTarget();
  return (
    <div
      className="fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground"
      data-slot="settings-sms"
    >
      <FieldGroup className="gap-8">
        <IntegrationSection integration="sms" entryId="sms-provider" />
      </FieldGroup>
    </div>
  );
}

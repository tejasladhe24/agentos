import { EMAIL_SECTION_LABELS, type EmailSection } from '../lib/email-section';
import { AddressesSection } from './addresses-section';
import { ComposeSection } from './compose-section';
import { DeliveriesSection } from './deliveries-section';
import { InboxSection } from './inbox-section';

export type EmailPanelProps = {
  section: EmailSection;
  canSend: boolean;
  error?: string | null;
};

export function EmailPanel({
  section,
  canSend,
  error = null,
}: EmailPanelProps) {
  return (
    <main
      className="flex h-full min-h-0 w-full flex-col gap-4 p-6"
      data-slot="email-panel"
      data-email-section={section}
    >
      <header>
        <h1 className="text-lg font-semibold tracking-tight">
          {EMAIL_SECTION_LABELS[section]}
        </h1>
        <p className="text-sm text-muted-foreground">
          Receive via inbound-email · send via notifications
        </p>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {section === 'inbox' ? <InboxSection /> : null}
      {section === 'deliveries' ? <DeliveriesSection /> : null}
      {section === 'compose' ? <ComposeSection canSend={canSend} /> : null}
      {section === 'addresses' ? (
        <AddressesSection canProvision={canSend} />
      ) : null}
    </main>
  );
}

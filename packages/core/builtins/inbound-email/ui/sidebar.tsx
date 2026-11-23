import { Button } from '@agentos/ui/components/button';
import { cn } from '@agentos/ui/lib/utils';

import {
  EMAIL_SECTION_LABELS,
  EMAIL_SECTIONS,
  type EmailSection,
} from './email-section';
import { useEmailSection } from './use-email-section';

/**
 * Email manager nav — left sidebar when Email is the active secondary view.
 */
export default function EmailSidebar() {
  const [section, selectSection] = useEmailSection();

  return (
    <nav
      className="flex h-full flex-col gap-4 p-4"
      data-slot="email-sidebar"
      aria-label="Email manager"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Email</h2>
        <p className="text-xs text-muted-foreground">
          Inbox, send, deliveries, addresses
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {EMAIL_SECTIONS.map((id) => (
          <li key={id}>
            <EmailNavButton
              section={id}
              active={section === id}
              onSelect={selectSection}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function EmailNavButton({
  section,
  active,
  onSelect,
}: {
  section: EmailSection;
  active: boolean;
  onSelect: (section: EmailSection) => void | Promise<void>;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      className={cn('w-full justify-start', active && 'font-medium')}
      aria-current={active ? 'page' : undefined}
      data-email-section={section}
      onClick={() => void onSelect(section)}
    >
      {EMAIL_SECTION_LABELS[section]}
    </Button>
  );
}

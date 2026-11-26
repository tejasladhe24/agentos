import { useHostUi } from '@agentos/core/client';
import { Button } from '@agentos/ui/components/button';

/**
 * Demo global right sheet — opened from the TopBar trigger, over any
 * workspace page. Closing uses the host API (same as Escape / backdrop).
 */
export default function RightSheet() {
  const ui = useHostUi();
  return (
    <div className="flex flex-col gap-3 p-4" data-demo-right-sheet>
      <p className="text-sm text-muted-foreground">
        This panel is a global right sheet. It stays open across Home, Settings,
        and extension pages.
      </p>
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void ui.closeRightSheet()}
        >
          Close sheet
        </Button>
      </div>
    </div>
  );
}

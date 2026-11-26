import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@agentos/ui/components/sheet';
import { cn } from '@agentos/ui/lib/utils';
import {
  useShellActiveRightSheet,
  useShellContributions,
} from '@agentos/core/shell/hooks';
import {
  contributionKey,
  useShellStore,
  type ExtensionEntry,
  type UiContribution,
} from '@agentos/core/shell/lib';
import { ExtensionFrame } from './extension-frame';

/**
 * TopBar height (`h-10`). The sheet starts below the top bar so its
 * `top-end` triggers stay visible and clickable while the sheet is open.
 * Inline style: wins over the `@agentos/ui` sheet's `inset-y-0` / `h-full`.
 */
const SHEET_TOP_OFFSET_STYLE = {
  top: '2.5rem',
  bottom: 0,
  height: 'auto',
} as const;

export type RightSheetSlotProps = {
  contributions?: UiContribution[];
  /** Override store active sheet (tests / controlled hosts). `null` = closed. */
  activeRightSheet?: string | null;
};

export type RightSheetFrame = {
  contribution: UiContribution;
  active: boolean;
};

export type RightSheetState = {
  open: boolean;
  title: string;
  description: string | undefined;
  /** Every right-sheet frame, in contribution order; only `active` is shown. */
  frames: RightSheetFrame[];
};

/**
 * Pure view model for {@link RightSheetSlot}.
 *
 * The sheet is open only when the active id has an enabled `right-sheet`
 * contribution, so an open sheet can never render empty. Every frame is
 * returned (not just the active one) so the caller keeps them all mounted.
 */
export function resolveRightSheetState({
  activeId,
  contributions,
  extensions,
}: {
  activeId: string | null;
  contributions: UiContribution[];
  extensions: ExtensionEntry[];
}): RightSheetState {
  const sheets = contributions.filter((c) => c.view === 'right-sheet');
  const open =
    activeId !== null &&
    sheets.some((contribution) => contribution.extensionId === activeId);
  const entry =
    activeId !== null ? extensions.find((e) => e.id === activeId) : undefined;
  return {
    open,
    title: entry?.rightSheet?.label ?? entry?.name ?? activeId ?? '',
    description: entry?.rightSheet?.description,
    frames: sheets.map((contribution) => ({
      contribution,
      active: open && contribution.extensionId === activeId,
    })),
  };
}

/**
 * Global right sheet host: one `@agentos/ui` Sheet over the workspace,
 * hosting the `ui/right-sheet.tsx` frame of the active extension.
 *
 * Every enabled `right-sheet` frame stays mounted (`keepMounted`) so opening
 * and closing the sheet never remounts an iframe or re-runs its handshake.
 * `MainWorkspace` is rendered outside this slot and is never remounted.
 */
export function RightSheetSlot({
  contributions: contributionsProp,
  activeRightSheet: activeProp,
}: RightSheetSlotProps) {
  const activeId = useShellActiveRightSheet(activeProp);
  const closeRightSheet = useShellStore((s) => s.closeRightSheet);
  const extensions = useShellStore((s) => s.extensions);
  const contributions = useShellContributions({
    contributions: contributionsProp,
  });
  const state = resolveRightSheetState({
    activeId,
    contributions,
    extensions,
  });

  return (
    <Sheet
      open={state.open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeRightSheet();
      }}
    >
      <SheetContent
        keepMounted
        data-slot="right-sheet"
        data-open={state.open ? 'true' : 'false'}
        data-extension-id={state.open ? activeId : undefined}
        style={SHEET_TOP_OFFSET_STYLE}
      >
        <SheetHeader>
          <SheetTitle>{state.title}</SheetTitle>
          {state.description ? (
            <SheetDescription>{state.description}</SheetDescription>
          ) : null}
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {state.frames.map(({ contribution, active }) => (
            <div
              key={contributionKey(contribution.extensionId, contribution.view)}
              className={cn('h-full w-full min-h-0', !active && 'hidden')}
              hidden={!active}
              data-right-sheet-active={active ? 'true' : 'false'}
            >
              <ExtensionFrame contribution={contribution} visible={active} />
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

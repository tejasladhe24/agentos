import {
  HandWavingIcon,
  HouseIcon,
  SquaresFourIcon,
  type Icon,
} from '@phosphor-icons/react';
import type { UiContribution } from '../ui-contribs/contribution';
import {
  resolveActivityBarSection,
  type ExtensionEntry,
} from './extension-catalog';
import { resolveExtensionIcon } from './resolve-extension-icon';
import type { ShellView, SidebarPanel } from './store';

/** Shell chrome that swaps `sidebarPanel` instead of `activeView`. */
export type ActivityBarShellPanel = Exclude<SidebarPanel, 'contribution'>;

export type ActivityBarItem = {
  id: ShellView | 'extensions' | 'hitl';
  label: string;
  Icon: Icon;
  /**
   * When set, activate toggles this left SidebarSlot panel.
   * When unset, activate switches `activeView` (main canvas + contribution sidebar).
   */
  panel?: ActivityBarShellPanel;
};

const HOME_ITEM: ActivityBarItem = {
  id: 'home',
  label: 'Home',
  Icon: HouseIcon,
};

const MANAGER_ITEM: ActivityBarItem = {
  id: 'extensions',
  label: 'Extensions',
  Icon: SquaresFourIcon,
  panel: 'extensions',
};

/** Non-page secondary builtins → Shell chrome actions (HITL inbox, etc.). */
const BUILTIN_ACTIVITY_CHROME: Record<string, Omit<ActivityBarItem, 'id'>> = {
  hitl: {
    label: 'Approvals',
    Icon: HandWavingIcon,
    panel: 'hitl',
  },
};

function isSecondary(ext: ExtensionEntry): boolean {
  return (
    resolveActivityBarSection(ext.activityBarSection, ext.kind, ext.id) ===
    'secondary'
  );
}

export type ActivityBarSections = {
  /** Top cluster: Home + primary page contributions (top → bottom). */
  primary: ActivityBarItem[];
  /**
   * Bottom cluster for `flex-col-reverse`: index 0 is nearest the bottom edge.
   * Array order (bottom → top): Extensions manager, secondary page builtins
   * (e.g. auth, settings), Approvals (HITL chrome) at the top of the cluster.
   */
  secondary: ActivityBarItem[];
};

/** Pure split of Activity Bar items into primary + secondary sections. */
export function buildActivityBarSections(input: {
  extensions: ExtensionEntry[];
  enabledById: Record<string, boolean>;
  contributions: UiContribution[];
}): ActivityBarSections {
  const { extensions, enabledById, contributions } = input;

  const pageExtensionIds = new Set(
    contributions.filter((c) => c.view === 'page').map((c) => c.extensionId),
  );

  const primaryPages: ActivityBarItem[] = extensions
    .filter(
      (ext) =>
        enabledById[ext.id] !== false &&
        pageExtensionIds.has(ext.id) &&
        !isSecondary(ext),
    )
    .map((ext) => ({
      id: ext.id,
      label: ext.name,
      Icon: resolveExtensionIcon(ext.icon),
    }));

  const secondaryChrome: ActivityBarItem[] = [];
  const secondaryPages: ActivityBarItem[] = [];
  for (const ext of extensions) {
    if (enabledById[ext.id] === false || !isSecondary(ext)) continue;
    const chrome = BUILTIN_ACTIVITY_CHROME[ext.id];
    if (chrome) {
      secondaryChrome.push({ id: ext.id, ...chrome });
      continue;
    }
    if (pageExtensionIds.has(ext.id) || ext.id === 'settings') {
      secondaryPages.push({
        id: ext.id,
        label: ext.name,
        Icon: resolveExtensionIcon(ext.icon),
      });
    }
  }

  return {
    primary: [HOME_ITEM, ...primaryPages],
    // flex-col-reverse: last item renders at the top of the secondary cluster.
    secondary: [MANAGER_ITEM, ...secondaryPages, ...secondaryChrome],
  };
}

import { HouseIcon, SquaresFourIcon, type Icon } from '@phosphor-icons/react';
import type { UiContribution } from '../ui-contribs/contribution';
import {
  resolveActivityBarSection,
  type ExtensionEntry,
} from './extension-catalog';
import { resolveExtensionIcon } from './resolve-extension-icon';
import type { ShellView } from './store';

/** Every Activity Bar item switches `activeView`; the URL follows (`/`, `/extensions`, `/ext/<id>`). */
export type ActivityBarItem = {
  id: ShellView;
  label: string;
  Icon: Icon;
};

const HOME_ITEM: ActivityBarItem = {
  id: 'home',
  label: 'Home',
  Icon: HouseIcon,
};

/** Shell-hosted Extensions Manager page at `/extensions` (admin only). */
const MANAGER_ITEM: ActivityBarItem = {
  id: 'extensions',
  label: 'Extensions',
  Icon: SquaresFourIcon,
};

/** Secondary Activity Bar items restricted to admin / owner roles (ticket 128). */
const ADMIN_ONLY_SECONDARY_IDS = new Set<string>(['secrets', 'extensions']);

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
   * Array order (bottom → top): Extensions manager (admin only), then secondary
   * page builtins (e.g. settings, files, email, activity, approvals; secrets is
   * admin only).
   */
  secondary: ActivityBarItem[];
};

/** Pure split of Activity Bar items into primary + secondary sections. */
export function buildActivityBarSections(input: {
  extensions: ExtensionEntry[];
  enabledById: Record<string, boolean>;
  contributions: UiContribution[];
  /** When false, admin-only secondary items (`secrets`, `extensions`) are omitted. */
  isAdmin?: boolean;
}): ActivityBarSections {
  const { extensions, enabledById, contributions, isAdmin = true } = input;

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

  const secondaryPages: ActivityBarItem[] = [];
  for (const ext of extensions) {
    if (enabledById[ext.id] === false || !isSecondary(ext)) continue;
    if (!isAdmin && ADMIN_ONLY_SECONDARY_IDS.has(ext.id)) continue;
    if (pageExtensionIds.has(ext.id) || ext.id === 'settings') {
      secondaryPages.push({
        id: ext.id,
        label: ext.name,
        Icon: resolveExtensionIcon(ext.icon),
      });
    }
  }

  const managerItems = isAdmin ? [MANAGER_ITEM] : [];

  return {
    primary: [HOME_ITEM, ...primaryPages],
    // flex-col-reverse: last item renders at the top of the secondary cluster.
    secondary: [...managerItems, ...secondaryPages],
  };
}

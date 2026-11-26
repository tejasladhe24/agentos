import type { ShellView } from '../chrome/store';
import type { UiContribution } from './contribution';

export type RightSidebarColumnContentInput = {
  activeView: ShellView;
  /** Right sidebar contributions (`view: 'right-sidebar'`). */
  rightSidebars: UiContribution[];
};

export type RightSidebarColumnVisibleInput = RightSidebarColumnContentInput & {
  rightSidebarOpen: boolean;
};

/**
 * Whether the right sidebar column has something to show for the active view
 * (ignoring open/closed). Active-extension host: empty on Home, Settings, or
 * extensions without `ui/right-sidebar.tsx`.
 */
export function rightSidebarColumnHasContent({
  activeView,
  rightSidebars,
}: RightSidebarColumnContentInput): boolean {
  if (activeView === 'home' || activeView === 'settings') return false;
  return rightSidebars.some((c) => c.extensionId === activeView);
}

/**
 * Whether the right sidebar column should appear expanded
 * (`rightSidebarOpen` + matching active-extension content).
 */
export function rightSidebarColumnVisible({
  rightSidebarOpen,
  ...content
}: RightSidebarColumnVisibleInput): boolean {
  return rightSidebarOpen && rightSidebarColumnHasContent(content);
}

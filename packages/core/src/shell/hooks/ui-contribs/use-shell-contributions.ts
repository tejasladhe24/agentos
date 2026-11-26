import { useMemo } from 'react';
import {
  filterContributions,
  useShellStore,
  type ExtensionView,
  type UiContribution,
} from '@agentos/core/shell/lib';

export type UseShellContributionsOptions = {
  /** Override store contributions (tests / controlled hosts). */
  contributions?: UiContribution[];
  /** When set, only contributions for this view are returned. */
  view?: ExtensionView;
};

/**
 * Resolves UI contributions from an optional override or the shell store,
 * optionally filtered by view kind.
 */
export function useShellContributions(
  options: UseShellContributionsOptions = {},
): UiContribution[] {
  const storeContributions = useShellStore((s) => s.contributions);
  const contributions = options.contributions ?? storeContributions;
  const { view } = options;
  return useMemo(
    () => filterContributions(contributions, view),
    [contributions, view],
  );
}

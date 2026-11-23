import type { ExtensionManagerStatus } from '../chrome/extension-catalog';
import type { ContributionRuntimeStatus, UiContribution } from './contribution';
import { contributionKey } from './contribution';

/**
 * Whether the Shell should show an in-canvas loading overlay for an extension frame.
 * Unset status counts as loading (cold mount before handshake starts).
 */
export function shouldShowExtensionFrameLoading(
  runtimeStatus: ContributionRuntimeStatus | undefined,
  visible: boolean,
): boolean {
  return (
    visible && (runtimeStatus === undefined || runtimeStatus === 'loading')
  );
}

/**
 * Derive Extension Manager row status from enable flag + mounted frame statuses.
 */
export function deriveExtensionManagerStatus(
  extensionId: string,
  enabled: boolean,
  contributions: UiContribution[],
  runtimeStatus: Record<string, ContributionRuntimeStatus>,
): ExtensionManagerStatus {
  if (!enabled) return 'disabled';

  const frames = contributions.filter((c) => c.extensionId === extensionId);
  if (frames.length === 0) return 'active';

  let anyLoading = false;
  for (const frame of frames) {
    const status =
      runtimeStatus[contributionKey(frame.extensionId, frame.view)];
    if (status === 'crashed') return 'crashed';
    if (status === 'loading' || status === undefined) anyLoading = true;
  }
  return anyLoading ? 'loading' : 'active';
}

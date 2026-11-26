import {} from '@tanstack/react-form';
import {} from 'zod';
import { IntegrationStatusInfo } from '@agentos/core/client/components/integration-card';
import { Badge } from '@agentos/ui/components/badge';
import {} from '@agentos/ui/components/button';
import {} from '@agentos/ui/components/input';
import {} from '@agentos/ui/components/loading-state';

import { formatBytes, type FilesMount } from '../lib/files-types';
import {} from './add-storage-dialog';
import {} from './mount-icon';
import {} from '../lib/use-files-mounts';
export function mountStatusMessage(mount: FilesMount): string {
  const label = mount.status === 'error' ? 'Error' : 'Disconnected';
  return mount.statusMessage ? `${label}: ${mount.statusMessage}` : label;
}

export function mountStatusInfo(mount: FilesMount) {
  if (mount.status === 'connected') return null;
  return (
    <IntegrationStatusInfo
      message={mountStatusMessage(mount)}
      tone={mount.status === 'error' ? 'error' : 'warning'}
      slot="files-mount-status"
    />
  );
}

export function connectedBadge(mount: FilesMount) {
  if (mount.status !== 'connected') return null;
  return <Badge variant="secondary">Connected</Badge>;
}

export function quotaLine(mount: FilesMount): string {
  if (!mount.quota) return '';
  const used = formatBytes(mount.quota.usedBytes);
  return mount.quota.limitBytes
    ? ` · ${used} of ${formatBytes(mount.quota.limitBytes)} used`
    : ` · ${used} used`;
}

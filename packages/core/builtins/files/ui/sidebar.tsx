import {
  HardDrivesIcon,
  LockSimpleIcon,
  TrashIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { cn } from '@agentos/ui/lib/utils';

import {
  resolveSelectedMount,
  type FilesMount,
  type FilesSection,
} from './files-types';
import { MountIcon } from './mount-icon';
import { useFilesMount } from './use-files-mount';
import { useFilesMounts } from './use-files-mounts';
import { useFilesPrefix } from './use-files-prefix';
import { useFilesSection } from './use-files-section';

const VIEWS: Array<{
  id: Exclude<FilesSection, 'files'>;
  label: string;
  description: string;
  icon: typeof TrashIcon;
}> = [
  {
    id: 'bin',
    label: 'Bin',
    description: 'Recently deleted, all storage',
    icon: TrashIcon,
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'Largest files first',
    icon: HardDrivesIcon,
  },
];

export type FilesSidebarNavProps = {
  mounts: FilesMount[];
  loading?: boolean;
  error?: string | null;
  section: FilesSection;
  mountId: string;
  onSelectMount: (mountId: string) => void;
  onSelectView: (section: Exclude<FilesSection, 'files'>) => void;
};

export function FilesSidebarNav({
  mounts,
  loading = false,
  error = null,
  section,
  mountId,
  onSelectMount,
  onSelectView,
}: FilesSidebarNavProps) {
  return (
    <nav
      className="flex h-full flex-col gap-4 p-4"
      data-slot="files-sidebar"
      aria-label="Files navigation"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Files</h2>
        <p className="text-xs text-muted-foreground">
          Mounted storage, bin, and usage
        </p>
      </div>
      <section className="flex flex-col gap-1" data-slot="files-mounts">
        <h3 className="px-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Mounted storage
        </h3>
        {loading ? (
          <LoadingState size="sm">Loading storage…</LoadingState>
        ) : error ? (
          <p className="px-1 text-xs text-destructive" role="alert">
            {error}
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {mounts.map((mount) => {
              const active = section === 'files' && mountId === mount.id;
              const disconnected = mount.status !== 'connected';
              return (
                <li key={mount.id}>
                  <Button
                    type="button"
                    variant={active ? 'secondary' : 'ghost'}
                    className={cn(
                      'h-auto w-full justify-start gap-2 px-3 py-2',
                      active && 'font-medium',
                    )}
                    aria-current={active ? 'page' : undefined}
                    data-files-mount={mount.id}
                    onClick={() => onSelectMount(mount.id)}
                  >
                    <MountIcon
                      provider={mount.provider}
                      className="size-4 shrink-0"
                    />
                    <span className="min-w-0 flex-1 truncate text-left">
                      {mount.name}
                    </span>
                    {mount.kind === 'personal' ? (
                      <LockSimpleIcon
                        className="size-3 shrink-0 text-muted-foreground"
                        data-slot="files-mount-personal"
                        role="img"
                        aria-label="Personal — only you can see this drive"
                      />
                    ) : null}
                    {disconnected ? (
                      <Badge
                        variant="destructive"
                        className="gap-1"
                        title={mount.statusMessage ?? 'Disconnected'}
                        data-slot="files-mount-warning"
                      >
                        <WarningIcon className="size-3" aria-hidden />
                        {mount.kind === 'personal' &&
                        mount.status === 'disconnected'
                          ? 'Reconnect'
                          : mount.status === 'error'
                            ? 'Error'
                            : 'Disconnected'}
                      </Badge>
                    ) : null}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <ul className="flex flex-col gap-1 border-t border-border pt-3">
        {VIEWS.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <li key={item.id}>
              <Button
                type="button"
                variant={active ? 'secondary' : 'ghost'}
                className={cn(
                  'h-auto w-full flex-col items-start gap-0.5 px-3 py-2',
                  active && 'font-medium',
                )}
                aria-current={active ? 'page' : undefined}
                data-files-section={item.id}
                onClick={() => onSelectView(item.id)}
              >
                <span className="flex w-full items-center gap-2">
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="pl-6 text-[10px] font-normal text-muted-foreground">
                  {item.description}
                </span>
              </Button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Files nav — one entry per visible mount, then Bin / Storage spanning all.
 */
export default function FilesSidebar() {
  const [section, setSection] = useFilesSection();
  const [, setPrefix] = useFilesPrefix();
  const [mountId, setMountId] = useFilesMount();
  const { data, loading, error } = useFilesMounts();

  return (
    <FilesSidebarNav
      mounts={data.mounts}
      loading={loading}
      error={error}
      section={section}
      mountId={resolveSelectedMount(data.mounts, mountId)?.id ?? mountId}
      onSelectMount={(id) => {
        void setMountId(id);
        void setSection('files');
        void setPrefix('');
      }}
      onSelectView={(view) => void setSection(view)}
    />
  );
}

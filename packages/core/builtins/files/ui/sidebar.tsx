import {
  HardDrivesIcon,
  HouseIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { cn } from '@agentos/ui/lib/utils';

import type { FilesSection } from './files-types';
import { useFilesSection } from './use-files-section';
import { useFilesPrefix } from './use-files-prefix';

const NAV: Array<{
  id: FilesSection;
  label: string;
  description: string;
  icon: typeof HouseIcon;
}> = [
  {
    id: 'files',
    label: 'My Files',
    description: 'Browse org Drive',
    icon: HouseIcon,
  },
  {
    id: 'bin',
    label: 'Bin',
    description: 'Recently deleted',
    icon: TrashIcon,
  },
  {
    id: 'storage',
    label: 'Storage',
    description: 'Largest files first',
    icon: HardDrivesIcon,
  },
];

/**
 * Files nav — My Files / Bin / Storage.
 */
export default function FilesSidebar() {
  const [section, setSection] = useFilesSection();
  const [, setPrefix] = useFilesPrefix();

  return (
    <nav
      className="flex h-full flex-col gap-4 p-4"
      data-slot="files-sidebar"
      aria-label="Files navigation"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Files</h2>
        <p className="text-xs text-muted-foreground">
          Drive, bin, and storage
        </p>
      </div>
      <ul className="flex flex-col gap-1">
        {NAV.map((item) => {
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
                onClick={() => {
                  void setSection(item.id);
                  if (item.id === 'files') void setPrefix('');
                }}
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

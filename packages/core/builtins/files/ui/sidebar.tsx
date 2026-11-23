import { useEffect, useState } from 'react';
import { FolderIcon, HouseIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { ScrollArea } from '@agentos/ui/components/scroll-area';
import { LoadingState } from '@agentos/ui/components/loading-state';
import { useHostApi } from '@agentos/core/client';
import { cn } from '@agentos/ui/lib/utils';

import {
  parseErrorBody,
  parseListResponse,
  type FilesListItem,
} from './files-types';
import { useFilesPrefix } from './use-files-prefix';

/**
 * Files nav — folder shortcuts when Files is the active secondary view.
 */
export default function FilesSidebar() {
  const api = useHostApi();
  const [prefix, selectPrefix] = useFilesPrefix();
  const [folders, setFolders] = useState<FilesListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      const res = await api.fetch('/blobs?prefix=&limit=100');
      if (cancelled) return;
      if (res.status === 401) {
        setError('Sign in to browse files.');
        setFolders([]);
        setLoading(false);
        return;
      }
      if (!res.ok) {
        setError(parseErrorBody(res.body, 'Failed to load folders'));
        setFolders([]);
        setLoading(false);
        return;
      }
      const list = parseListResponse(res.body);
      setFolders(list.items.filter((i) => i.kind === 'folder'));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, prefix]);

  return (
    <nav
      className="flex h-full flex-col gap-4 p-4"
      data-slot="files-sidebar"
      aria-label="Files navigation"
    >
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Files</h2>
        <p className="text-xs text-muted-foreground">
          Browse org storage by folder prefix
        </p>
      </div>
      <Button
        type="button"
        variant={prefix === '' ? 'secondary' : 'ghost'}
        className={cn(
          'w-full justify-start gap-2',
          prefix === '' && 'font-medium',
        )}
        aria-current={prefix === '' ? 'page' : undefined}
        onClick={() => void selectPrefix('')}
      >
        <HouseIcon className="size-4" aria-hidden />
        All files
      </Button>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? (
        <LoadingState size="sm">Loading folders…</LoadingState>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-1">
            {folders.map((folder) => {
              const folderPrefix = folder.relativeKey.endsWith('/')
                ? folder.relativeKey
                : `${folder.relativeKey}/`;
              const active = prefix === folderPrefix;
              return (
                <li key={folder.key}>
                  <Button
                    type="button"
                    variant={active ? 'secondary' : 'ghost'}
                    className={cn(
                      'w-full justify-start gap-2',
                      active && 'font-medium',
                    )}
                    aria-current={active ? 'page' : undefined}
                    data-files-prefix={folderPrefix}
                    onClick={() => void selectPrefix(folderPrefix)}
                  >
                    <FolderIcon className="size-4 shrink-0" aria-hidden />
                    <span className="truncate">{folder.name}</span>
                  </Button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </nav>
  );
}

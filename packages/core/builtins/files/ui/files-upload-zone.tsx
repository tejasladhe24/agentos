import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from 'react';
import { CloudArrowUpIcon } from '@phosphor-icons/react';
import { Button } from '@agentos/ui/components/button';
import { cn } from '@agentos/ui/lib/utils';

import type { UploadProgressItem } from './files-types';

export type FilesUploadZoneProps = {
  disabled?: boolean;
  progress?: UploadProgressItem[];
  onUploadFiles: (files: File[]) => void | Promise<void>;
  /**
   * `button` — toolbar upload control.
   * `surface` — full-area drop target wrapping children (Drive-style).
   * `panel` — legacy dashed upload panel.
   */
  variant?: 'button' | 'surface' | 'panel';
  children?: ReactNode;
  className?: string;
};

export function FilesUploadZone({
  disabled = false,
  progress = [],
  onUploadFiles,
  variant = 'panel',
  children,
  className,
}: FilesUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const pickFiles = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList?.length || disabled) return;
      void onUploadFiles(Array.from(fileList));
    },
    [disabled, onUploadFiles],
  );

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      className="sr-only"
      aria-label="Choose files to upload"
      disabled={disabled}
      onChange={(e) => {
        handleFiles(e.target.files);
        e.target.value = '';
      }}
    />
  );

  const dragHandlers = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragOver(true);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (!disabled) setDragOver(true);
    },
    onDragLeave: (e: DragEvent) => {
      e.preventDefault();
      if (e.currentTarget === e.target) setDragOver(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      handleFiles(e.dataTransfer.files);
    },
  };

  if (variant === 'button') {
    return (
      <div data-slot="files-upload-zone" className={className}>
        {fileInput}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={pickFiles}
          aria-label="Upload files"
        >
          <CloudArrowUpIcon className="size-4" aria-hidden />
          Upload
        </Button>
      </div>
    );
  }

  if (variant === 'surface') {
    return (
      <div
        data-slot="files-upload-zone"
        className={cn('relative flex min-h-0 flex-1 flex-col', className)}
        {...dragHandlers}
      >
        {fileInput}
        {progress.length > 0 ? (
          <ul
            className="shrink-0 border-b border-border px-3 py-2 text-xs"
            aria-live="polite"
            data-slot="files-upload-progress"
          >
            {progress.map((item) => (
              <li
                key={item.id}
                className={cn(
                  'flex items-center justify-between gap-2',
                  item.status === 'error' && 'text-destructive',
                  item.status === 'done' && 'text-muted-foreground',
                )}
              >
                <span className="truncate">{item.name}</span>
                <span className="shrink-0 capitalize">{item.status}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="relative min-h-0 flex-1">{children}</div>
        {dragOver ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10"
            aria-hidden
          >
            <p className="rounded-md bg-background/90 px-3 py-2 text-sm font-medium text-foreground shadow-sm">
              Drop files to upload
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section
      data-slot="files-upload-zone"
      className={cn('flex flex-col gap-2', className)}
      {...dragHandlers}
    >
      {fileInput}
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-md border border-dashed p-4 text-center transition-colors',
          dragOver && 'border-primary bg-primary/5',
          disabled && 'opacity-50',
        )}
      >
        <CloudArrowUpIcon
          className="size-8 text-muted-foreground"
          aria-hidden
        />
        <p className="text-sm text-muted-foreground">
          Drag files here or use the picker to upload into the current folder.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={pickFiles}
        >
          Choose files
        </Button>
      </div>
      {progress.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs" aria-live="polite">
          {progress.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-center justify-between gap-2 rounded px-2 py-1',
                item.status === 'error' && 'text-destructive',
                item.status === 'done' && 'text-muted-foreground',
              )}
            >
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 capitalize">{item.status}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import {
  isFieldInvalid,
  toFieldErrors,
} from '@agentos/core/client/lib/form-errors';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@agentos/ui/components/alert-dialog';
import { Button } from '@agentos/ui/components/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@agentos/ui/components/dialog';
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
  FieldTitle,
} from '@agentos/ui/components/field';
import { Input } from '@agentos/ui/components/input';
import { RadioGroup, RadioGroupItem } from '@agentos/ui/components/radio-group';

import type { FilesListItem, FilesMount } from '../../lib/files-types';
import { driveCopy } from '../../lib/personal-drives';
import { MountIcon } from '../mount-icon';

const renameItemSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
});

const moveItemsSchema = z.object({
  destination: z.string(),
});

const copyItemsSchema = z.object({
  mountId: z.string().min(1, 'Choose a destination storage'),
  destination: z.string(),
});

export function useRenameForm({
  target,
  onRename,
  onDone,
}: {
  target: FilesListItem | null;
  onRename: (item: FilesListItem, newName: string) => Promise<void>;
  onDone: () => void;
}) {
  return useForm({
    defaultValues: { name: '' },
    validators: { onSubmit: renameItemSchema },
    onSubmit: async ({ value }) => {
      if (!target) return;
      await onRename(target, value.name.trim());
      onDone();
    },
  });
}

export function RenameDialog({
  target,
  form,
  onClose,
}: {
  target: FilesListItem | null;
  form: ReturnType<typeof useRenameForm>;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
          </DialogHeader>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <>
                <form.Field name="name">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <Input
                          name={field.name}
                          value={field.state.value}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                          aria-label="New name"
                          aria-invalid={invalid || undefined}
                          disabled={isSubmitting}
                          autoFocus
                        />
                        {invalid ? (
                          <FieldError
                            errors={toFieldErrors(field.state.meta.errors)}
                          />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSubmitting}
                    onClick={() => onClose()}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? 'Saving…' : 'Save'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useMoveForm({
  selectedItems,
  onMove,
  onDone,
}: {
  selectedItems: FilesListItem[];
  onMove: (items: FilesListItem[], destinationPrefix: string) => Promise<void>;
  onDone: () => void;
}) {
  const form = useForm({
    defaultValues: { destination: '' },
    validators: { onSubmit: moveItemsSchema },
    onSubmit: async ({ value }) => {
      if (!selectedItems.length) return;
      await onMove(selectedItems, value.destination);
      onDone();
      form.reset({ destination: '' });
    },
  });
  return form;
}

export function MoveDialog({
  open,
  onOpenChange,
  form,
  selectedCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ReturnType<typeof useMoveForm>;
  selectedCount: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>Move to folder</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Destination prefix relative to org root (e.g. <code>docs/</code>).
            Moving {selectedCount} item(s).
          </p>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <>
                <form.Field name="destination">
                  {(field) => (
                    <Field>
                      <Input
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-label="Destination prefix"
                        placeholder="folder/subfolder/"
                        disabled={isSubmitting}
                      />
                    </Field>
                  )}
                </form.Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSubmitting}
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting || selectedCount === 0}
                  >
                    {isSubmitting ? 'Moving…' : 'Move'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function useCopyForm({
  selectedItems,
  onCopyTo,
  onDone,
}: {
  selectedItems: FilesListItem[];
  onCopyTo?: (
    items: FilesListItem[],
    mountId: string,
    destinationPrefix: string,
  ) => Promise<void>;
  onDone: () => void;
}) {
  const form = useForm({
    defaultValues: { mountId: '', destination: '' },
    validators: { onSubmit: copyItemsSchema },
    onSubmit: async ({ value }) => {
      if (!onCopyTo || !selectedItems.length) return;
      await onCopyTo(selectedItems, value.mountId, value.destination);
      onDone();
      form.reset({ mountId: '', destination: '' });
    },
  });
  return form;
}

export function CopyDialog({
  open,
  onOpenChange,
  form,
  selectedCount,
  personalSource,
  mount,
  copyTargets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: ReturnType<typeof useCopyForm>;
  selectedCount: number;
  personalSource: boolean;
  mount?: FilesMount;
  copyTargets: FilesMount[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="files-copy-dialog">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {personalSource ? 'Copy to org storage' : 'Copy to storage'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            {personalSource
              ? [
                  `Copies ${selectedCount} item(s) into org storage.`,
                  driveCopy(mount?.provider).exportNote,
                  'The originals stay in your drive.',
                ]
                  .filter(Boolean)
                  .join(' ')
              : `Copies ${selectedCount} item(s) into another mount. Files are streamed across storage backends; originals stay in place.`}
          </p>
          <form.Subscribe selector={(state) => state.isSubmitting}>
            {(isSubmitting) => (
              <>
                <form.Field name="mountId">
                  {(field) => {
                    const invalid = isFieldInvalid(field.state.meta);
                    return (
                      <Field data-invalid={invalid || undefined}>
                        <RadioGroup
                          value={field.state.value}
                          onValueChange={(v) => field.handleChange(String(v))}
                          aria-label="Destination storage"
                        >
                          {copyTargets.map((target) => (
                            <FieldLabel
                              key={target.id}
                              htmlFor={`files-copy-${target.id}`}
                            >
                              <Field orientation="horizontal">
                                <MountIcon
                                  provider={target.provider}
                                  className="size-4 shrink-0"
                                />
                                <FieldContent>
                                  <FieldTitle>
                                    {target.name}
                                    {target.id === mount?.id
                                      ? ' (current)'
                                      : ''}
                                  </FieldTitle>
                                </FieldContent>
                                <RadioGroupItem
                                  value={target.id}
                                  id={`files-copy-${target.id}`}
                                />
                              </Field>
                            </FieldLabel>
                          ))}
                        </RadioGroup>
                        {invalid ? (
                          <FieldError
                            errors={toFieldErrors(field.state.meta.errors)}
                          />
                        ) : null}
                      </Field>
                    );
                  }}
                </form.Field>
                <form.Field name="destination">
                  {(field) => (
                    <Field>
                      <Input
                        name={field.name}
                        value={field.state.value}
                        onBlur={field.handleBlur}
                        onChange={(e) => field.handleChange(e.target.value)}
                        aria-label="Destination folder"
                        placeholder="folder/subfolder/ (empty = root)"
                        disabled={isSubmitting}
                      />
                    </Field>
                  )}
                </form.Field>
                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={isSubmitting}
                    onClick={() => onOpenChange(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={isSubmitting || !selectedCount}
                  >
                    {isSubmitting ? 'Copying…' : 'Copy'}
                  </Button>
                </DialogFooter>
              </>
            )}
          </form.Subscribe>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteDialog({
  open,
  onOpenChange,
  isBin,
  nativeTrash,
  mount,
  targetCount,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isBin: boolean;
  nativeTrash: boolean;
  mount?: FilesMount;
  targetCount: number;
  busy: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isBin ? 'Delete permanently?' : 'Move to Bin?'}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isBin
              ? `Permanently deletes ${targetCount} item(s) from Bin.`
              : nativeTrash
                ? `Moves ${targetCount} item(s) to the ${mount?.name ?? 'provider'} trash. Restore them from Bin or the provider.`
                : `Moves ${targetCount} item(s) to Bin. They can be restored until auto-delete runs.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {isBin ? 'Delete forever' : 'Move to Bin'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

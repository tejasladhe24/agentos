import { z } from 'zod';

import type {
  StorageProviderField,
  StorageProviderInfo,
  StorageProviderPreset,
} from './files-types';

export type Step = 'provider' | 'form';

export type Choice = {
  provider: StorageProviderInfo;
  preset?: StorageProviderPreset;
};

export type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok' }
  | { status: 'failed'; message: string };

export type AddStorageFormValues = {
  name: string;
  values: Record<string, string>;
  makeDefault: boolean;
};

export function choiceId(
  provider: StorageProviderInfo,
  preset?: StorageProviderPreset,
) {
  return preset ? `${provider.id}:${preset.id}` : provider.id;
}

/** Fields shown for a provider + preset (secrets always shown). */
export function visibleFields(
  provider: StorageProviderInfo,
  preset?: StorageProviderPreset,
): StorageProviderField[] {
  const fields = provider.fields ?? [];
  if (!preset?.fields) return fields;
  const allowed = new Set(preset.fields);
  return fields.filter((f) => f.type === 'secret' || allowed.has(f.id));
}

export function createAddStorageSchema(
  fields: StorageProviderField[],
  required: Set<string>,
) {
  return z
    .object({
      name: z.string().trim().min(1, 'Name is required'),
      values: z.record(z.string(), z.string()),
      makeDefault: z.boolean(),
    })
    .superRefine((data, ctx) => {
      for (const field of fields) {
        if (required.has(field.id) && !(data.values[field.id] ?? '').trim()) {
          ctx.addIssue({
            code: 'custom',
            message: `${field.label} is required`,
            path: ['values', field.id],
          });
        }
      }
    });
}

export type AddStorageDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: StorageProviderInfo[];
  onAdded: () => Promise<void> | void;
};

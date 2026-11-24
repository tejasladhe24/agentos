import {
  AddressBookIcon,
  BuildingsIcon,
  CubeIcon,
  EnvelopeIcon,
  FlaskIcon,
  FolderIcon,
  GearSixIcon,
  InvoiceIcon,
  KeyIcon,
  ListBulletsIcon,
  ReceiptIcon,
  SparkleIcon,
  UserIcon,
  UsersIcon,
  type Icon,
} from '@phosphor-icons/react';

/**
 * Curated Phosphor icons extensions may declare in `meta.json` (`"icon": "Users"`).
 * Unknown / missing names fall back to {@link DEFAULT_EXTENSION_ICON}.
 */
export const EXTENSION_ICON_MAP = {
  AddressBook: AddressBookIcon,
  Buildings: BuildingsIcon,
  Cube: CubeIcon,
  Envelope: EnvelopeIcon,
  Flask: FlaskIcon,
  Folder: FolderIcon,
  GearSix: GearSixIcon,
  Invoice: InvoiceIcon,
  Key: KeyIcon,
  ListBullets: ListBulletsIcon,
  Receipt: ReceiptIcon,
  Sparkle: SparkleIcon,
  User: UserIcon,
  Users: UsersIcon,
} as const satisfies Record<string, Icon>;

export type ExtensionIconName = keyof typeof EXTENSION_ICON_MAP;

export const DEFAULT_EXTENSION_ICON: Icon = CubeIcon;

/** Normalize `Users` / `UsersIcon` → map key `Users`. */
export function normalizeExtensionIconName(
  raw: string | undefined | null,
): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith('Icon') ? trimmed.slice(0, -4) : trimmed;
}

/** Resolve a meta icon name to a Phosphor component (fallback: Cube). */
export function resolveExtensionIcon(raw: string | undefined | null): Icon {
  const key = normalizeExtensionIconName(raw);
  if (!key) return DEFAULT_EXTENSION_ICON;
  const Icon = EXTENSION_ICON_MAP[key as ExtensionIconName];
  return Icon ?? DEFAULT_EXTENSION_ICON;
}

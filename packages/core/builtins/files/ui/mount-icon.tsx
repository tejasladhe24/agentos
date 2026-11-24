import {
  CloudIcon,
  DatabaseIcon,
  DropboxLogoIcon,
  GoogleDriveLogoIcon,
  HardDrivesIcon,
  TriangleIcon,
  UploadSimpleIcon,
  type Icon,
} from '@phosphor-icons/react';

const PROVIDER_ICONS: Record<string, Icon> = {
  filesystem: HardDrivesIcon,
  s3: CloudIcon,
  uploadthing: UploadSimpleIcon,
  'vercel-blob': TriangleIcon,
  'google-drive': GoogleDriveLogoIcon,
  dropbox: DropboxLogoIcon,
};

export function MountIcon({
  provider,
  className,
}: {
  provider: string;
  className?: string;
}) {
  const Icon = PROVIDER_ICONS[provider] ?? DatabaseIcon;
  return <Icon className={className} aria-hidden data-provider={provider} />;
}

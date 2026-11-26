import type { ComponentProps } from 'react';
import { cn } from '@agentos/ui/lib/utils';

/**
 * Shared frame for extension `ui/settings.tsx` pages: fills the Shell's
 * settings iframe, scrolls, and matches the app background. Extra props
 * (`data-slot`, `data-*`) pass through to the root element.
 */
export function SettingsPage({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'fixed inset-0 overflow-y-auto bg-background px-6 py-6 text-foreground',
        className,
      )}
      {...props}
    />
  );
}

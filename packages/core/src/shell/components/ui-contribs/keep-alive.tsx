import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '@agentos/ui/lib/utils';

export type KeepAliveProps = HTMLAttributes<HTMLDivElement> & {
  active: boolean;
  children: ReactNode;
};

/** Mounts children the first time `active` is true, then only hides them. */
export function KeepAlive({
  active,
  children,
  className,
  ...rest
}: KeepAliveProps) {
  const [opened, setOpened] = useState(active);
  if (active && !opened) setOpened(true);
  if (!opened && !active) return null;

  return (
    <div
      {...rest}
      className={cn(className, !active && 'hidden')}
      hidden={!active}
      aria-hidden={!active}
      data-active={active ? 'true' : 'false'}
    >
      {children}
    </div>
  );
}

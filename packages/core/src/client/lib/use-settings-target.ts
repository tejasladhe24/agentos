import { useEffect, useState } from 'react';

export type SettingsTarget = {
  /** Section id from `meta.json` `settings[].id` (empty when none). */
  section: string;
  /** Entry id from `settings[].entries[].id`, when search targeted one. */
  entry: string | null;
};

/** Parse `#section` or `#section:entry` into a {@link SettingsTarget}. */
export function parseSettingsTarget(hash: string): SettingsTarget {
  const raw = hash.replace(/^#/, '');
  const [section = '', entry] = raw.split(':');
  return { section, entry: entry ? entry : null };
}

function readTarget(): SettingsTarget {
  if (typeof window === 'undefined') return { section: '', entry: null };
  return parseSettingsTarget(window.location.hash);
}

const FLASH_MS = 1500;
const MAX_WAIT_MS = 1200;

/**
 * Settings extension SDK hook. The Shell selects a section (and optionally a
 * single setting from search) by writing `section[:entry]` into the iframe's
 * `location.hash`; this hook exposes it reactively.
 *
 * When an entry is targeted, the element marked `data-setting-entry="<id>"` is
 * scrolled into view and briefly highlighted once it renders.
 */
export function useSettingsTarget(): SettingsTarget {
  const [target, setTarget] = useState<SettingsTarget>(readTarget);

  useEffect(() => {
    const onHashChange = () => setTarget(readTarget());
    window.addEventListener('hashchange', onHashChange);
    onHashChange();
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const { section, entry } = target;
  useEffect(() => {
    if (!entry) return;
    let frame = 0;
    let cancelled = false;
    const start = performance.now();

    const attempt = () => {
      if (cancelled) return;
      const el = document.querySelector<HTMLElement>(
        `[data-setting-entry="${CSS.escape(entry)}"]`,
      );
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.animate?.(
          [
            { boxShadow: '0 0 0 2px var(--ring)' },
            { boxShadow: '0 0 0 2px transparent' },
          ],
          { duration: FLASH_MS, easing: 'ease-out' },
        );
        return;
      }
      if (performance.now() - start < MAX_WAIT_MS) {
        frame = requestAnimationFrame(attempt);
      }
    };
    frame = requestAnimationFrame(attempt);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [section, entry]);

  return target;
}

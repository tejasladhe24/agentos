import { useCallback, useEffect, useRef, useState } from 'react';
import {
  connectHostSharedState,
  type HostSharedState,
  type HostSharedStateOptions,
} from './host-shared-state';
import { useHost } from './use-host';

export type { HostSharedStateOptions } from './host-shared-state';

/**
 * State shared by every frame of an extension (page, sidebar, right sidebar,
 * …). The value is persisted in host storage under `key` and each change is
 * announced on `topic`, so other frames update live without any direct
 * frame-to-frame channel. `T` must be JSON-serializable.
 *
 * Replaces ad-hoc `BroadcastChannel` hooks; behaviour matches them:
 * updates are optimistic locally, then stored, then announced.
 */
export function useHostSharedState<T>(
  key: string,
  initial: T,
  options: HostSharedStateOptions<T>,
): [T, (next: T) => Promise<void>] {
  const host = useHost();
  const { topic } = options;
  const [value, setValue] = useState<T>(initial);

  const initialRef = useRef(initial);
  const parseRef = useRef(options.parse);
  parseRef.current = options.parse;
  const hasParse = options.parse !== undefined;
  const stateRef = useRef<HostSharedState<T> | null>(null);

  useEffect(() => {
    const state = connectHostSharedState<T>(
      host,
      key,
      initialRef.current,
      {
        topic,
        // Read through the ref so a new `parse` identity never reconnects.
        parse: hasParse ? (raw) => parseRef.current!(raw) : undefined,
      },
      setValue,
    );
    stateRef.current = state;
    return () => {
      stateRef.current = null;
      state.stop();
    };
  }, [host, key, topic, hasParse]);

  const update = useCallback(async (next: T) => {
    const state = stateRef.current;
    if (state) return state.update(next);
    // Called before the effect connected: still apply locally.
    setValue(next);
  }, []);

  return [value, update];
}

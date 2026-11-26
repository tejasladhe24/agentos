import { HOST_THEME_TOPIC, type EventPayload } from '@agentos/core/sdk';

/** The slice of an activated frame's remote the theme push needs. */
export type ThemeEventRemote = {
  onEvent(topic: string, payload: EventPayload): Promise<void> | void;
};

/**
 * Tell a live frame the app theme changed (`shell.theme.changed`). The frame
 * re-applies its `<html>` theme class; its iframe `src` is never touched, so
 * nothing reloads or re-handshakes. Failures are swallowed: a crashed or
 * closing frame must not break the Shell's theme toggle.
 */
export function pushThemeToFrame(
  remote: ThemeEventRemote | null,
  theme: string | undefined,
): void {
  if (!remote || !theme) return;
  try {
    void Promise.resolve(remote.onEvent(HOST_THEME_TOPIC, { theme })).catch(
      () => {},
    );
  } catch {
    /* synchronous failure from a torn-down remote */
  }
}

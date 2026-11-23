import { useEffect, useRef, useState } from 'react';
import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';

const REVEAL_TIMEOUT_MS = 15_000;

export type SecretRevealControlsProps = {
  secretKey: string;
  onReveal: (key: string) => Promise<string>;
  disabled?: boolean;
};

export function SecretRevealControls({
  secretKey,
  onReveal,
  disabled = false,
}: SecretRevealControlsProps) {
  const [value, setValue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  function mask() {
    clearTimer();
    setValue(null);
  }

  useEffect(() => () => clearTimer(), []);

  async function handleReveal() {
    if (value !== null) {
      mask();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const revealed = await onReveal(secretKey);
      setValue(revealed);
      clearTimer();
      timerRef.current = setTimeout(() => {
        setValue(null);
        timerRef.current = null;
      }, REVEAL_TIMEOUT_MS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reveal failed');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    setBusy(true);
    setError(null);
    try {
      const text = value ?? (await onReveal(secretKey));
      await navigator.clipboard.writeText(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copy failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="flex min-w-[12rem] flex-col gap-1"
      data-slot="secret-reveal-controls"
    >
      <div className="flex items-center gap-1">
        <Input
          type={value === null ? 'password' : 'text'}
          readOnly
          value={value === null ? '••••••••' : value}
          className="font-mono"
          autoComplete="off"
          aria-label={
            value === null
              ? `Secret ${secretKey} masked`
              : `Secret ${secretKey} revealed`
          }
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void handleReveal()}
          disabled={disabled || busy}
          aria-pressed={value !== null}
        >
          {value === null ? 'Reveal' : 'Hide'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void handleCopy()}
          disabled={disabled || busy}
        >
          Copy
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function MasterKeyBanner() {
  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
      data-slot="secrets-master-key-banner"
      role="alert"
    >
      Vault writes are disabled: set{' '}
      <code className="font-mono text-xs">AGENT_OS_EXT_SECRETS_MASTER_KEY</code>{' '}
      (32-byte key as base64 or 64-char hex) and restart the secrets API.
    </div>
  );
}

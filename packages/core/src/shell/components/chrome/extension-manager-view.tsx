import { ExtensionManagerList } from './extension-manager-list';

/**
 * Full-page Extensions Manager at `/extensions` (admin only). Shell-hosted,
 * rendered in `MainWorkspace` alongside Settings — not an overlay on the left
 * sidebar.
 */
export function ExtensionManagerView() {
  return (
    <div
      className="flex h-full min-h-0 w-full flex-col gap-4 overflow-hidden bg-background p-6"
      data-slot="extension-manager-view"
      aria-label="Extensions manager"
    >
      <header className="shrink-0">
        <h1 className="text-lg font-semibold text-foreground">Extensions</h1>
        <p className="text-sm text-muted-foreground">
          Turn customer extensions on or off. Builtins are always on and hidden
          unless you show them with the filter.
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <ExtensionManagerList />
      </div>
    </div>
  );
}

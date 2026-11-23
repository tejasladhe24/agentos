import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';

export type SecretsToolbarProps = {
  filter: string;
  onFilterChange: (value: string) => void;
  canCreate: boolean;
  onCreate: () => void;
  onRefresh: () => void;
  busy?: boolean;
};

export function SecretsToolbar({
  filter,
  onFilterChange,
  canCreate,
  onCreate,
  onRefresh,
  busy = false,
}: SecretsToolbarProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2"
      data-slot="secrets-toolbar"
    >
      <Input
        className="max-w-xs"
        placeholder="Filter by key prefix…"
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
        autoComplete="off"
        aria-label="Filter secrets by key"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={busy}
      >
        Refresh
      </Button>
      {canCreate ? (
        <Button type="button" size="sm" onClick={onCreate} disabled={busy}>
          Create secret
        </Button>
      ) : null}
    </div>
  );
}

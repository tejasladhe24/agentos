import { Button } from '@agentos/ui/components/button';
import { Input } from '@agentos/ui/components/input';

import type { ActivityFilters } from '../lib/types';

type ActivityFiltersProps = {
  filters: ActivityFilters;
  onChange: (next: ActivityFilters) => void;
  onApply: () => void;
  onClear: () => void;
  disabled?: boolean;
};

export function ActivityFiltersBar({
  filters,
  onChange,
  onApply,
  onClear,
  disabled,
}: ActivityFiltersProps) {
  function setField<K extends keyof ActivityFilters>(
    key: K,
    value: ActivityFilters[K],
  ) {
    onChange({ ...filters, [key]: value });
  }

  return (
    <form
      className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      data-slot="activity-filters"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <Input
        aria-label="Search"
        placeholder="Search action, actor, resource, meta"
        value={filters.q}
        disabled={disabled}
        onChange={(event) => setField('q', event.target.value)}
      />
      <Input
        aria-label="Action filter"
        placeholder="Action (exact or prefix*)"
        value={filters.action}
        disabled={disabled}
        onChange={(event) => setField('action', event.target.value)}
      />
      <Input
        aria-label="Actor filter"
        placeholder="Actor"
        value={filters.actor}
        disabled={disabled}
        onChange={(event) => setField('actor', event.target.value)}
      />
      <Input
        aria-label="Resource filter"
        placeholder="Resource"
        value={filters.resource}
        disabled={disabled}
        onChange={(event) => setField('resource', event.target.value)}
      />
      <Input
        aria-label="From date"
        type="datetime-local"
        value={filters.from}
        disabled={disabled}
        onChange={(event) => setField('from', event.target.value)}
      />
      <Input
        aria-label="To date"
        type="datetime-local"
        value={filters.to}
        disabled={disabled}
        onChange={(event) => setField('to', event.target.value)}
      />
      <div className="flex flex-wrap gap-2 md:col-span-2 xl:col-span-3">
        <Button type="submit" disabled={disabled}>
          Apply filters
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onClear}
        >
          Clear
        </Button>
      </div>
    </form>
  );
}

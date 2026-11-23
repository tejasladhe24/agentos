import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import { formatTime, metaSummary } from '../lib/parse-filters';
import type { AuditEntry } from '../lib/types';

type ActivityTableProps = {
  entries: AuditEntry[];
  selectedId?: string;
  onSelect: (entry: AuditEntry) => void;
};

export function ActivityTable({
  entries,
  selectedId,
  onSelect,
}: ActivityTableProps) {
  return (
    <Table data-slot="activity-table">
      <TableHeader>
        <TableRow>
          <TableHead>Time</TableHead>
          <TableHead>Action</TableHead>
          <TableHead>Actor</TableHead>
          <TableHead>Resource</TableHead>
          <TableHead>Meta</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {entries.map((entry) => (
          <TableRow
            key={entry.id}
            data-state={selectedId === entry.id ? 'selected' : undefined}
            className="cursor-pointer"
            tabIndex={0}
            aria-selected={selectedId === entry.id}
            onClick={() => onSelect(entry)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(entry);
              }
            }}
          >
            <TableCell className="whitespace-nowrap font-mono text-xs">
              {formatTime(entry.at)}
            </TableCell>
            <TableCell className="font-medium">{entry.action}</TableCell>
            <TableCell>{entry.actor ?? '—'}</TableCell>
            <TableCell className="max-w-[12rem] truncate">
              {entry.resource ?? '—'}
            </TableCell>
            <TableCell className="max-w-[16rem] truncate font-mono text-xs text-muted-foreground">
              {metaSummary(entry.meta)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

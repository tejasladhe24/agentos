import { Badge } from '@agentos/ui/components/badge';
import { Button } from '@agentos/ui/components/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@agentos/ui/components/table';

import type { SecretListItem } from '../lib/types';
import { SecretRevealControls } from './secret-reveal-controls';

function formatStamp(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export type SecretsTableProps = {
  keys: SecretListItem[];
  canWrite: boolean;
  onReveal: (key: string) => Promise<string>;
  onRotate: (key: string) => void;
  onDelete: (key: string) => void;
};

export function SecretsTable({
  keys,
  canWrite,
  onReveal,
  onRotate,
  onDelete,
}: SecretsTableProps) {
  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-slot="secrets-empty">
        No vault secrets for this organization yet.
      </p>
    );
  }

  return (
    <div className="overflow-auto" data-slot="secrets-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Key</TableHead>
            <TableHead>Updated</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Value</TableHead>
            {canWrite ? (
              <TableHead className="w-[1%]">Actions</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((item) => (
            <TableRow key={item.key}>
              <TableCell className="font-mono text-xs">{item.key}</TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatStamp(item.updatedAt)}
              </TableCell>
              <TableCell className="text-xs text-muted-foreground">
                {formatStamp(item.expiresAt)}
              </TableCell>
              <TableCell>
                <Badge variant="secondary">vault</Badge>
              </TableCell>
              <TableCell>
                <SecretRevealControls
                  secretKey={item.key}
                  onReveal={onReveal}
                />
              </TableCell>
              {canWrite ? (
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onRotate(item.key)}
                    >
                      Rotate
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      onClick={() => onDelete(item.key)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

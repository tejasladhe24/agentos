import type { AuditEntry } from './types';

function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportEntriesJson(entries: AuditEntry[]): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadBlob(
    `activity-${stamp}.json`,
    new Blob([JSON.stringify(entries, null, 2)], {
      type: 'application/json;charset=utf-8',
    }),
  );
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function exportEntriesCsv(entries: AuditEntry[]): void {
  const header = ['id', 'at', 'action', 'actor', 'resource', 'orgId', 'meta'];
  const lines = [header.join(',')];
  for (const entry of entries) {
    lines.push(
      [
        entry.id,
        entry.at,
        entry.action,
        entry.actor ?? '',
        entry.resource ?? '',
        entry.orgId ?? '',
        entry.meta ? JSON.stringify(entry.meta) : '',
      ]
        .map((cell) => csvEscape(String(cell)))
        .join(','),
    );
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  downloadBlob(
    `activity-${stamp}.csv`,
    new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }),
  );
}

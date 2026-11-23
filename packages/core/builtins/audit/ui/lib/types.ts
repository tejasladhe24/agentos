export type AuditEntry = {
  id: string;
  action: string;
  actor?: string;
  resource?: string;
  meta?: Record<string, unknown>;
  orgId?: string;
  at: string;
};

export type ActivityFilters = {
  action: string;
  actor: string;
  resource: string;
  q: string;
  from: string;
  to: string;
};

export const EMPTY_FILTERS: ActivityFilters = {
  action: '',
  actor: '',
  resource: '',
  q: '',
  from: '',
  to: '',
};

export const ACTIVITY_FILTERS_STORAGE_KEY = 'audit.activity.filters';

export const MAX_EXPORT_ROWS = 1000;

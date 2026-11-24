export class BlobStoreError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** Machine-readable reason for the UI (e.g. `reconnect_required`). */
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'BlobStoreError';
  }
}

/** Provider access was revoked or expired; the owner must reconnect. */
export class MountReconnectError extends BlobStoreError {
  constructor(message: string) {
    super(message, 409, 'reconnect_required');
    this.name = 'MountReconnectError';
  }
}

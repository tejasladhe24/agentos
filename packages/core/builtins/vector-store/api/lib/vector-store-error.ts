/** Domain error with HTTP status for vector-store routes. */
export class VectorStoreError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VectorStoreError';
    this.status = status;
  }
}

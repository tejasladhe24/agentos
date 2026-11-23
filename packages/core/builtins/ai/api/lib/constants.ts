/** Default upstream port — must match `meta.json`. */
export const AI_PORT = 6113;

/** Default Vite gateway origin for registry + tool HTTP. */
export const DEFAULT_GATEWAY_URL = 'http://127.0.0.1:5173';

/** Max attachments per generate request. */
export const MAX_ATTACHMENTS = 8;

/** Max decoded bytes per attachment. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** Max total decoded bytes across all attachments. */
export const MAX_ATTACHMENTS_TOTAL_BYTES = 20 * 1024 * 1024;

/** MIME types accepted for multimodal generate inputs. */
export const ALLOWED_ATTACHMENT_MEDIA_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
]);

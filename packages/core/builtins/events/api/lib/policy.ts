import { MAX_TOPIC_LENGTH, SERVER_ONLY_TOPICS } from './constants';

const TOPIC_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Validate a topic name. Returns an error message, or `null` when valid.
 * Topics are lowercase dotted names (`<extension>.<event>`).
 */
export function topicError(topic: string): string | null {
  if (!topic) return 'topic required';
  if (topic.length > MAX_TOPIC_LENGTH) {
    return `topic must be at most ${MAX_TOPIC_LENGTH} characters`;
  }
  if (!TOPIC_RE.test(topic)) {
    return 'topic must be lowercase letters, digits, ".", "_" or "-"';
  }
  return null;
}

/** True for topics only server-side builtins may publish. */
export function isServerOnlyTopic(topic: string): boolean {
  return SERVER_ONLY_TOPICS.has(topic);
}

/** Cloud metadata hostnames a scheduled HTTP job must never reach. */
const BLOCKED_HOSTS = new Set([
  'metadata.google.internal',
  'metadata',
  'instance-data',
]);

/**
 * Validate the target of a scheduled HTTP job. Returns an error message, or
 * `null` when allowed.
 *
 * Only service callers may create `http` jobs, and they legitimately target
 * in-stack APIs on loopback, so loopback stays allowed. Non-http(s) schemes,
 * embedded credentials, and cloud metadata / link-local addresses are not.
 */
export function jobUrlError(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return 'url is invalid';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'url must use http or https';
  }
  if (url.username || url.password) {
    return 'url must not contain credentials';
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    BLOCKED_HOSTS.has(host) ||
    host.startsWith('169.254.') ||
    host.startsWith('fe80:') ||
    host === 'fd00:ec2::254'
  ) {
    return 'url targets a blocked metadata or link-local address';
  }
  return null;
}

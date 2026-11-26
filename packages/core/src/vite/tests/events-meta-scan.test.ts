import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanExtensions } from '@agentos/core/vite/lib/scan-extensions';
import {
  isValidEventTopic,
  MAX_EVENT_TOPIC_LENGTH,
} from '@agentos/core/vite/lib/types';

let root: string;
let extensionsDir: string;
let builtinsDir: string;

function writeExtension(id: string, meta: unknown): void {
  const dir = join(extensionsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify(meta));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentos-events-meta-'));
  extensionsDir = join(root, 'extensions');
  builtinsDir = join(root, 'builtins');
  mkdirSync(builtinsDir, { recursive: true });

  writeExtension('files', {
    name: 'Files',
    events: {
      publishes: ['files.selection.changed', 'files.selection.changed'],
      subscribes: ['email.received', 'hitl.resolved'],
    },
  });
  writeExtension('mixed', {
    events: {
      // Foreign namespace + malformed names are dropped; the valid one stays.
      publishes: ['files.selection.changed', 'Bad Topic', 'mixed.ready', 42],
      subscribes: ['', 'ok.topic'],
    },
  });
  writeExtension('empty', { events: { publishes: ['other.thing'] } });
  writeExtension('malformed', { events: 'nope' });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function metaOf(id: string) {
  const model = scanExtensions({ extensionsDir, builtinsDir });
  return model.extensions.find((e) => e.id === id)?.meta;
}

describe('meta.json events declarations', () => {
  test('parses and de-duplicates publishes and subscribes', () => {
    expect(metaOf('files')?.events).toEqual({
      publishes: ['files.selection.changed'],
      subscribes: ['email.received', 'hitl.resolved'],
    });
  });

  test('drops invalid topics and publishes outside the extension namespace', () => {
    expect(metaOf('mixed')?.events).toEqual({
      publishes: ['mixed.ready'],
      subscribes: ['ok.topic'],
    });
  });

  test('omits events entirely when nothing valid remains', () => {
    expect(metaOf('empty')?.events).toBeUndefined();
    expect(metaOf('malformed')?.events).toBeUndefined();
  });

  test('isValidEventTopic mirrors the events builtin rules', () => {
    expect(isValidEventTopic('files.selection.changed')).toBe(true);
    expect(isValidEventTopic('a')).toBe(true);
    expect(isValidEventTopic('')).toBe(false);
    expect(isValidEventTopic('Has.Caps')).toBe(false);
    expect(isValidEventTopic('-lead')).toBe(false);
    expect(isValidEventTopic('has space')).toBe(false);
    expect(isValidEventTopic('a'.repeat(MAX_EVENT_TOPIC_LENGTH))).toBe(true);
    expect(isValidEventTopic('a'.repeat(MAX_EVENT_TOPIC_LENGTH + 1))).toBe(
      false,
    );
  });
});

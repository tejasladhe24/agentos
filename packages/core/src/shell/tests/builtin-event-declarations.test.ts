import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as filesTypes from '@agentos/core/builtins/files/ui/files-types';
import * as emailSection from '@agentos/core/builtins/inbound-email/ui/email-section';

const builtinsDir = join(import.meta.dir, '../../../builtins');

function metaEvents(id: string): {
  publishes: string[];
  subscribes: string[];
} {
  const meta = JSON.parse(
    readFileSync(join(builtinsDir, id, 'meta.json'), 'utf8'),
  ) as { events?: { publishes?: string[]; subscribes?: string[] } };
  return {
    publishes: meta.events?.publishes ?? [],
    subscribes: meta.events?.subscribes ?? [],
  };
}

describe('builtin UIs declare every bus topic they use', () => {
  test('files: all *_TOPIC constants are published and subscribed in meta.json', () => {
    const topics = Object.entries(filesTypes)
      .filter(([name]) => name.endsWith('_TOPIC'))
      .map(([, value]) => value as string);
    expect(topics.length).toBeGreaterThanOrEqual(6);

    const { publishes, subscribes } = metaEvents('files');
    for (const topic of topics) {
      expect(topic.startsWith('files.')).toBe(true);
      expect(publishes).toContain(topic);
      expect(subscribes).toContain(topic);
    }
  });

  test('inbound-email: section topic is declared and namespaced', () => {
    const topic = emailSection.EMAIL_SECTION_TOPIC;
    expect(topic.startsWith('inbound-email.')).toBe(true);
    const { publishes, subscribes } = metaEvents('inbound-email');
    expect(publishes).toContain(topic);
    expect(subscribes).toContain(topic);
  });
});

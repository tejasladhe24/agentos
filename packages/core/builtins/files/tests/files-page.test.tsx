import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { HostAPIClient } from '@agentos/core/sdk';

import FilesPage from '../ui/page';
import { FilesBrowser } from '../ui/files-browser';

function createTestHost(
  fetchImpl: HostAPIClient['api']['fetch'],
): HostAPIClient {
  const store = new Map<string, unknown>();
  return {
    storage: {
      get: async (key) => (store.has(key) ? (store.get(key) as never) : null),
      set: async (key, value) => {
        store.set(key, value);
      },
      remove: async (key) => {
        store.delete(key);
      },
    },
    notifications: { show: async () => {} },
    ai: { generateText: async () => ({ text: '' }) },
    hitl: {
      requestApproval: async () => ({ approved: true, id: '1' }),
    },
    api: { fetch: fetchImpl },
    events: { publish: async () => {} },
  };
}

const noopAsync = async () => {};

describe('FilesPage', () => {
  test('renders page chrome and initial loading state', () => {
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({ items: [], cursor: null, prefix: '' }),
        })),
        children: createElement(FilesPage),
      }),
    );
    expect(html).toContain('data-slot="files-page"');
    expect(html).toContain('Files');
    expect(html).toContain('data-slot="files-browser"');
    expect(html).toContain('Loading files');
    expect(html).toContain('data-slot="files-detail"');
    expect(html).toContain('data-slot="files-upload-zone"');
  });
});

describe('FilesBrowser states', () => {
  const baseProps = {
    prefix: '',
    searchQuery: '',
    viewMode: 'grid' as const,
    selectedKeys: new Set<string>(),
    upload: { progress: [], onUploadFiles: noopAsync },
    onSearchQueryChange: () => {},
    onSearchSubmit: () => {},
    onClearSearch: () => {},
    onViewModeChange: () => {},
    onPrefixChange: () => {},
    onOpenItem: () => {},
    onToggleSelect: () => {},
    onSelectAll: () => {},
    onClearSelection: () => {},
    onDownloadSelected: () => {},
    onRename: noopAsync,
    onMove: noopAsync,
    onDelete: noopAsync,
  };

  test('renders empty folder state', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...baseProps,
        items: [],
        loading: false,
        error: null,
      }),
    );
    expect(html).toContain('data-slot="files-empty"');
    expect(html).toContain('This folder is empty');
  });

  test('renders loaded grid items', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...baseProps,
        items: [
          {
            key: 'orgs/o1/readme.txt',
            name: 'readme.txt',
            kind: 'file',
            bytes: 12,
            relativeKey: 'readme.txt',
          },
          {
            key: 'orgs/o1/docs/',
            name: 'docs',
            kind: 'folder',
            relativeKey: 'docs/',
          },
        ],
        loading: false,
        error: null,
      }),
    );
    expect(html).toContain('readme.txt');
    expect(html).toContain('docs');
    expect(html).not.toContain('data-slot="files-empty"');
  });

  test('renders error banner', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...baseProps,
        items: [],
        loading: false,
        error: 'forbidden',
      }),
    );
    expect(html).toContain('data-slot="files-error"');
    expect(html).toContain('forbidden');
  });
});

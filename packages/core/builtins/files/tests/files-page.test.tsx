import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { HostAPIClient } from '@agentos/core/sdk';

import FilesPage from '../ui/page';
import { FilesBrowser } from '../ui/files-browser';
import type { FilesMount } from '../ui/files-types';
import { FilesSidebarNav } from '../ui/sidebar';

const CAPS = {
  serverSideCopy: true,
  nativeFolders: true,
  nativeTrash: false,
  versions: false,
  maxFileSize: 1024,
  exportFormats: [],
  quota: false,
};

const PLATFORM: FilesMount = {
  id: 'platform',
  kind: 'org',
  provider: 'filesystem',
  name: 'Platform storage',
  isDefault: true,
  status: 'connected',
  builtin: true,
  capabilities: CAPS,
};

const ARCHIVE: FilesMount = {
  id: 'm_archive',
  kind: 'org',
  provider: 's3',
  name: 'Archive',
  isDefault: false,
  status: 'connected',
  capabilities: { ...CAPS, nativeTrash: true },
};

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
    expect(html).not.toContain('Org-scoped storage');
    expect(html).toContain('data-slot="files-browser"');
    expect(html).toContain('Loading files');
    expect(html).not.toContain('data-slot="files-detail"');
    expect(html).toContain('data-slot="files-info-button"');
    expect(html).toContain('data-slot="files-upload-zone"');
    expect(html).toContain('>Files</button>');
  });
});

describe('FilesBrowser states', () => {
  const baseProps = {
    section: 'files' as const,
    prefix: '',
    searchQuery: '',
    viewMode: 'list' as const,
    selectedKeys: new Set<string>(),
    detailOpen: false,
    upload: { progress: [], onUploadFiles: noopAsync },
    onSearchQueryChange: () => {},
    onSearchSubmit: () => {},
    onClearSearch: () => {},
    onViewModeChange: () => {},
    onToggleDetail: () => {},
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

  test('renders loaded list items', () => {
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
    expect(html).toContain('Name');
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

  test('storage view shows name and size columns only', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...baseProps,
        section: 'storage',
        items: [
          {
            key: 'orgs/o1/big.bin',
            name: 'big.bin',
            kind: 'file',
            bytes: 2048,
            relativeKey: 'big.bin',
          },
        ],
        loading: false,
        error: null,
      }),
    );
    expect(html).toContain('data-slot="files-storage"');
    expect(html).toContain('big.bin');
    expect(html).toContain('2.0 KB');
  });

  test('root crumb is the selected mount; empty state shows its max file size', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...baseProps,
        items: [],
        loading: false,
        error: null,
        mount: ARCHIVE,
        mounts: [PLATFORM, ARCHIVE],
      }),
    );
    expect(html).toContain('Archive');
    expect(html).toContain('data-files-mount="m_archive"');
    expect(html).toContain('max 1.0 KB each');
  });

  test('Copy to… appears only with more than one connected mount', () => {
    const item = {
      key: 'orgs/o1/a.txt',
      name: 'a.txt',
      kind: 'file' as const,
      bytes: 1,
      relativeKey: 'a.txt',
      ref: 'files://platform/a.txt',
      mountId: 'platform',
    };
    const props = {
      ...baseProps,
      items: [item],
      selectedKeys: new Set([item.ref]),
      loading: false,
      error: null,
      mount: PLATFORM,
      onCopyTo: noopAsync,
    };
    const single = renderToStaticMarkup(
      createElement(FilesBrowser, { ...props, mounts: [PLATFORM] }),
    );
    expect(single).not.toContain('data-slot="files-copy-to"');
    const multi = renderToStaticMarkup(
      createElement(FilesBrowser, { ...props, mounts: [PLATFORM, ARCHIVE] }),
    );
    expect(multi).toContain('data-slot="files-copy-to"');
  });

  test('storage view adds a Location column across mounts', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...baseProps,
        section: 'storage',
        items: [
          {
            key: 'files://m_archive/big.bin',
            name: 'big.bin',
            kind: 'file',
            bytes: 2048,
            relativeKey: 'big.bin',
            mountId: 'm_archive',
            mountName: 'Archive',
          },
        ],
        loading: false,
        error: null,
        mounts: [PLATFORM, ARCHIVE],
      }),
    );
    expect(html).toContain('Location');
    expect(html).toContain('Archive');
  });
});

describe('FilesSidebarNav', () => {
  test('lists mounted storage and flags disconnected mounts', () => {
    const html = renderToStaticMarkup(
      createElement(FilesSidebarNav, {
        mounts: [
          PLATFORM,
          { ...ARCHIVE, status: 'disconnected', statusMessage: 'bad creds' },
        ],
        section: 'files',
        mountId: 'platform',
        onSelectMount: () => {},
        onSelectView: () => {},
      }),
    );
    expect(html).toContain('Mounted storage');
    expect(html).toContain('Platform storage');
    expect(html).toContain('Archive');
    expect(html).toContain('data-slot="files-mount-warning"');
    expect(html).toContain('Disconnected');
    expect(html).toContain('Bin');
  });
});

describe('AddStorageDialog fields', () => {
  test('preset fields filter non-secret inputs; secrets always shown', async () => {
    const { visibleFields } = await import('../ui/add-storage-dialog');
    const provider = {
      id: 's3',
      label: 'S3',
      orgAddable: true,
      personal: false,
      fields: [
        { id: 'bucket', label: 'Bucket', type: 'text' as const },
        { id: 'accountId', label: 'Account', type: 'text' as const },
        { id: 'endpoint', label: 'Endpoint', type: 'text' as const },
        { id: 'secretAccessKey', label: 'Secret', type: 'secret' as const },
      ],
    };
    const ids = visibleFields(provider, {
      id: 'r2',
      label: 'R2',
      fields: ['bucket', 'accountId'],
    }).map((f) => f.id);
    expect(ids).toEqual(['bucket', 'accountId', 'secretAccessKey']);
    expect(visibleFields(provider).length).toBe(4);
  });
});

describe('resolveSelectedMount', () => {
  test('falls back to the org default mount when nothing is chosen', async () => {
    const { resolveSelectedMount } = await import('../ui/files-types');
    const mounts = [
      { ...PLATFORM, isDefault: false },
      { ...ARCHIVE, isDefault: true },
    ];
    expect(resolveSelectedMount(mounts, '')?.id).toBe('m_archive');
    expect(resolveSelectedMount(mounts, 'platform')?.id).toBe('platform');
    expect(resolveSelectedMount(mounts, 'gone')?.id).toBe('m_archive');
  });
});

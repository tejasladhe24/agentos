import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HostProvider } from '@agentos/core/client';
import type { HostAPIClient } from '@agentos/core/sdk';

import FilesPage from '../ui/page';
import FilesRightSidebar from '../ui/right-sidebar';
import FilesSettings from '../ui/settings';
import { FilesBrowser } from '../ui/components/files-browser';
import type { FilesMount } from '../ui/lib/files-types';
import { FilesSidebarNav } from '../ui/sidebar';
import { ConnectedDrives } from '../ui/components/connected-drives';
import { StorageBackends } from '../ui/components/storage-backends';

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
    notifications: {
      show: async () => {},
      send: async () => ({ id: 'n1', status: 'sent' }),
      getEmailPreferences: async () => ({ from: null, orgFrom: null }),
      setEmailPreferences: async (from: string | null) => ({
        from,
        orgFrom: null,
      }),
    },
    auth: { can: async () => true },
    files: { blobUrl: async (key: string) => `/b/${key}` },
    ai: { generateText: async () => ({ text: '' }) },
    hitl: {
      requestApproval: async () => ({ approved: true, id: '1' }),
    },
    api: { fetch: fetchImpl },
    events: {
      publish: async () => {},
      publishLocal: async () => {},
      subscribe: async () => 'sub',
      unsubscribe: async () => {},
    },
    navigation: { openExternal: async () => {} },
    ui: {
      setRightSidebarOpen: async () => {},
      toggleRightSidebar: async () => false,
      isRightSidebarOpen: async () => false,
      openRightSheet: async () => {},
      closeRightSheet: async () => {},
      toggleRightSheet: async () => null,
      getActiveRightSheet: async () => null,
    },
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
    expect(html).not.toContain('data-slot="files-layout"');
    expect(html).not.toContain('data-slot="files-detail"');
    expect(html).toContain('data-slot="files-info-button"');
    expect(html).toContain('data-slot="files-upload-zone"');
    expect(html).toContain('>Files</button>');
  });

  test('FilesRightSidebar renders details panel via Shell right sidebar slot', () => {
    const html = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(async () => ({
          ok: true,
          status: 200,
          body: JSON.stringify({
            mounts: [PLATFORM],
            defaultMountId: 'platform',
            providers: [],
            canManage: false,
          }),
        })),
        children: createElement(FilesRightSidebar),
      }),
    );
    expect(html).toContain('data-slot="files-right-sidebar"');
    expect(html).toContain('data-slot="files-detail"');
    expect(html).toContain('Details');
    expect(html).toContain('Choose a row to see preview and file info.');
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

const DRIVE: FilesMount = {
  id: 'p_drive',
  kind: 'personal',
  ownerUserId: 'u_a',
  provider: 'google-drive',
  name: 'Google Drive (a@example.com)',
  isDefault: false,
  status: 'connected',
  config: { email: 'a@example.com' },
  capabilities: { ...CAPS, nativeTrash: true, quota: true },
  quota: { usedBytes: 1024 * 1024, limitBytes: 1024 * 1024 * 1024 },
};

describe('personal drives', () => {
  const browserProps = {
    section: 'files' as const,
    prefix: '',
    searchQuery: '',
    viewMode: 'list' as const,
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
    loading: false,
    error: null,
  };

  test('personal files copy only to org storage', () => {
    const item = {
      key: 'My Drive/Plan',
      name: 'Plan',
      kind: 'file' as const,
      relativeKey: 'My Drive/Plan',
      ref: 'files://p_drive/My Drive/Plan',
      mountId: 'p_drive',
      exportFormats: ['docx', 'pdf'],
    };
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...browserProps,
        items: [item],
        selectedKeys: new Set([item.ref]),
        mount: DRIVE,
        mounts: [PLATFORM, DRIVE],
        onCopyTo: noopAsync,
      }),
    );
    expect(html).toContain('Copy to org storage');
    expect(html).not.toContain('data-slot="files-reconnect"');
  });

  test('revoked drive shows a reconnect prompt', () => {
    const html = renderToStaticMarkup(
      createElement(FilesBrowser, {
        ...browserProps,
        items: [],
        selectedKeys: new Set<string>(),
        mount: {
          ...DRIVE,
          status: 'disconnected',
          statusMessage: 'Google Drive access expired',
        },
        mounts: [PLATFORM, DRIVE],
        onReconnect: () => {},
      }),
    );
    expect(html).toContain('data-slot="files-reconnect"');
    expect(html).toContain('Google Drive access expired');
    expect(html).toContain('Reconnect');
  });

  test('sidebar marks personal drives and asks to reconnect', () => {
    const html = renderToStaticMarkup(
      createElement(FilesSidebarNav, {
        mounts: [PLATFORM, { ...DRIVE, status: 'disconnected' }],
        section: 'files',
        mountId: 'platform',
        onSelectMount: () => {},
        onSelectView: () => {},
      }),
    );
    expect(html).toContain('data-slot="files-mount-personal"');
    expect(html).toContain('Reconnect');
  });

  test('My connected drives lists drives with quota and connect buttons', () => {
    const render = (connectable: boolean) =>
      renderToStaticMarkup(
        createElement(HostProvider, {
          host: createTestHost(async () => ({
            ok: true,
            status: 200,
            body: '{}',
          })),
          children: createElement(ConnectedDrives, {
            data: {
              mounts: [PLATFORM, DRIVE],
              defaultMountId: 'platform',
              providers: [
                {
                  id: 'google-drive',
                  label: 'Google Drive',
                  orgAddable: false,
                  personal: true,
                  connectable,
                },
                {
                  id: 'onedrive',
                  label: 'OneDrive',
                  orgAddable: false,
                  personal: true,
                  connectable,
                },
              ],
              canManage: false,
            },
            loading: false,
            reload: noopAsync,
          }),
        }),
      );
    const html = render(true);
    expect(html).toContain('Google Drive (a@example.com)');
    expect(html).toContain('1.0 MB of 1.0 GB used');
    expect(html).toContain('Connect Google Drive');
    expect(html).toContain('data-slot="field-set"');
    expect(html).toContain('data-slot="files-connected-drives"');
    expect(html).not.toContain('data-slot="card"');
    expect(html).toMatch(
      /data-connect-provider="google-drive"(?![^>]*\sdisabled="")/,
    );
    expect(html).toContain('Connect OneDrive');
    expect(html).toMatch(
      /data-connect-provider="onedrive"(?![^>]*\sdisabled="")/,
    );
    expect(render(false)).toContain('not configured on this deployment');
  });

  test('FilesSettings separates sections with FieldSeparator and renders mounts as Fields', () => {
    const settingsHtml = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(async () => ({
          ok: true,
          status: 200,
          body: '{}',
        })),
        children: createElement(FilesSettings),
      }),
    );
    expect(settingsHtml).toContain('data-slot="settings-files"');
    expect(settingsHtml).toContain('data-slot="field-group"');
    expect(settingsHtml).toContain('data-slot="field-separator"');
    expect(settingsHtml).not.toContain('data-slot="card"');

    const backendsHtml = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(async () => ({
          ok: true,
          status: 200,
          body: '{}',
        })),
        children: createElement(StorageBackends, {
          data: {
            mounts: [PLATFORM, ARCHIVE],
            defaultMountId: 'platform',
            providers: [],
            canManage: true,
          },
          loading: false,
          error: null,
          reload: noopAsync,
        }),
      }),
    );
    expect(backendsHtml).toContain('data-slot="files-storage-backends"');
    expect(backendsHtml).toContain('data-orientation="horizontal"');
    expect(backendsHtml).not.toContain('<ul');

    const errorHtml = renderToStaticMarkup(
      createElement(HostProvider, {
        host: createTestHost(async () => ({
          ok: true,
          status: 200,
          body: '{}',
        })),
        children: createElement(StorageBackends, {
          data: {
            mounts: [
              {
                ...ARCHIVE,
                status: 'error',
                statusMessage: 'Access denied',
              },
            ],
            defaultMountId: 'm_archive',
            providers: [],
            canManage: true,
          },
          loading: false,
          error: null,
          reload: noopAsync,
        }),
      }),
    );
    expect(errorHtml).toContain('aria-label="Error: Access denied"');
    expect(errorHtml.indexOf('aria-label="Error: Access denied"')).toBeLessThan(
      errorHtml.indexOf('Archive'),
    );
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
    const { visibleFields } = await import('../ui/lib/add-storage-form');
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
    const { resolveSelectedMount } = await import('../ui/lib/files-types');
    const mounts = [
      { ...PLATFORM, isDefault: false },
      { ...ARCHIVE, isDefault: true },
    ];
    expect(resolveSelectedMount(mounts, '')?.id).toBe('m_archive');
    expect(resolveSelectedMount(mounts, 'platform')?.id).toBe('platform');
    expect(resolveSelectedMount(mounts, 'gone')?.id).toBe('m_archive');
  });
});

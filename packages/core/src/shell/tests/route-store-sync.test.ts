import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createMemoryHistory } from '@tanstack/react-router';
import { createRouteStoreSync, useShellStore } from '@agentos/core/shell/lib';

function resetStore() {
  useShellStore.setState({
    activeView: 'home',
    settingsKey: null,
    settingsEntryId: null,
    enabledById: {},
  });
}

function setup(initial: string) {
  const history = createMemoryHistory({ initialEntries: [initial] });
  const sync = createRouteStoreSync(history);
  return { history, sync };
}

describe('route ↔ store sync', () => {
  let stop: (() => void) | null = null;

  beforeEach(resetStore);
  afterEach(() => {
    stop?.();
    stop = null;
  });

  describe('bootstrap', () => {
    test('deep link wins over the store', () => {
      useShellStore.setState({ activeView: 'files' });
      const { history, sync } = setup('/ext/crm');
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('crm');
      expect(history.location.pathname).toBe('/ext/crm');
    });

    test('bare "/" resumes the restored Activity Bar selection (replace)', () => {
      useShellStore.setState({ activeView: 'files' });
      const { history, sync } = setup('/');
      const before = history.length;
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('files');
      expect(history.location.pathname).toBe('/ext/files');
      expect(history.length).toBe(before);
    });

    test('bare "/" with store at Home stays Home', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('home');
      expect(history.location.pathname).toBe('/');
    });

    test('settings deep link seeds section and entry', () => {
      const { sync } = setup('/settings?section=files%3Astorage&entry=s3');
      sync.bootstrap();
      const state = useShellStore.getState();
      expect(state.activeView).toBe('settings');
      expect(state.settingsKey).toBe('files:storage');
      expect(state.settingsEntryId).toBe('s3');
    });

    test('settings URL without a section keeps the store selection', () => {
      useShellStore.setState({ settingsKey: 'ai:providers' });
      const { sync } = setup('/settings');
      sync.bootstrap();
      expect(useShellStore.getState().settingsKey).toBe('ai:providers');
    });

    test('non-workspace paths are left alone', () => {
      useShellStore.setState({ activeView: 'files' });
      const { history, sync } = setup('/login?next=%2Fext%2Fcrm');
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('files');
      expect(history.location.pathname).toBe('/login');
    });

    test('explicitly disabled extension falls back to Home', () => {
      useShellStore.setState({ enabledById: { crm: false } });
      const { history, sync } = setup('/ext/crm');
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('home');
      expect(history.location.pathname).toBe('/');
    });
  });

  describe('start (live sync)', () => {
    test('store view change pushes the URL', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      stop = sync.start();
      const before = history.length;

      useShellStore.getState().setActiveView('crm');

      expect(history.location.pathname).toBe('/ext/crm');
      expect(history.length).toBe(before + 1);
    });

    test('URL change (back/forward) updates the store', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      stop = sync.start();

      useShellStore.getState().setActiveView('crm');
      useShellStore.getState().setActiveView('files');
      expect(history.location.pathname).toBe('/ext/files');

      history.back();
      expect(history.location.pathname).toBe('/ext/crm');
      expect(useShellStore.getState().activeView).toBe('crm');

      history.back();
      expect(useShellStore.getState().activeView).toBe('home');

      history.forward();
      expect(useShellStore.getState().activeView).toBe('crm');
    });

    test('push to a workspace URL updates the store', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      stop = sync.start();

      history.push('/ext/crm');

      expect(useShellStore.getState().activeView).toBe('crm');
    });

    test('/extensions follows the store both ways (Shell view, not an extension)', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      stop = sync.start();

      useShellStore.getState().setActiveView('extensions');
      expect(history.location.pathname).toBe('/extensions');

      history.push('/');
      expect(useShellStore.getState().activeView).toBe('home');

      history.push('/extensions');
      expect(useShellStore.getState().activeView).toBe('extensions');
    });

    test('deep link to /extensions keeps the Extensions view', () => {
      const { history, sync } = setup('/extensions');
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('extensions');
      expect(history.location.pathname).toBe('/extensions');
    });

    test('deep link to /ext/hitl opens the Approvals page', () => {
      const { history, sync } = setup('/ext/hitl');
      sync.bootstrap();
      expect(useShellStore.getState().activeView).toBe('hitl');
      expect(history.location.pathname).toBe('/ext/hitl');
    });

    test('settings selection change replaces (does not grow history)', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      stop = sync.start();
      useShellStore.getState().setActiveView('settings');
      const before = history.length;

      useShellStore.getState().setSettingsKey('files:storage', 's3');

      expect(history.location.pathname).toBe('/settings');
      expect(history.location.search).toBe('?section=files%3Astorage&entry=s3');
      expect(history.length).toBe(before);
    });

    test('settings URL change updates the store selection', () => {
      const { history, sync } = setup('/settings?section=a');
      sync.bootstrap();
      stop = sync.start();

      history.push('/settings?section=b&entry=e');

      const state = useShellStore.getState();
      expect(state.settingsKey).toBe('b');
      expect(state.settingsEntryId).toBe('e');
    });

    test('settings URL without section is filled in from the store', () => {
      useShellStore.setState({ settingsKey: 'ai:providers' });
      const { history, sync } = setup('/ext/crm');
      sync.bootstrap();
      stop = sync.start();

      useShellStore.getState().setActiveView('settings');

      expect(history.location.pathname).toBe('/settings');
      expect(history.location.search).toBe('?section=ai%3Aproviders');
    });

    test('does not echo: one store change produces one history entry', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      stop = sync.start();
      const before = history.length;

      useShellStore.getState().setActiveView('crm');
      // Unrelated store churn must not navigate again.
      useShellStore.getState().setSidebarOpen(false);
      useShellStore.getState().setStatusText('hello');

      expect(history.length).toBe(before + 1);
    });

    test('never navigates away from non-workspace paths', () => {
      const { history, sync } = setup('/login');
      sync.bootstrap();
      stop = sync.start();

      useShellStore.getState().setActiveView('crm');

      expect(history.location.pathname).toBe('/login');
    });

    test('applyLocation brings the store to the URL (login → workspace)', () => {
      const { history, sync } = setup('/login');
      sync.bootstrap();
      history.push('/ext/files');
      expect(useShellStore.getState().activeView).toBe('home');

      sync.applyLocation();

      expect(useShellStore.getState().activeView).toBe('files');
    });

    test('stop() detaches both directions', () => {
      const { history, sync } = setup('/');
      sync.bootstrap();
      const unsubscribe = sync.start();
      unsubscribe();

      useShellStore.getState().setActiveView('crm');
      expect(history.location.pathname).toBe('/');

      history.push('/ext/files');
      expect(useShellStore.getState().activeView).toBe('crm');
    });
  });
});

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  resolveRightSheetState,
  RightSheetSlot,
} from '@agentos/core/shell/components';
import type { ExtensionEntry, UiContribution } from '@agentos/core/shell/lib';

const contributions: UiContribution[] = [
  {
    extensionId: 'notes',
    view: 'right-sheet',
    src: '/__agentos/ext/notes/right-sheet.html',
  },
  {
    extensionId: 'reports',
    view: 'right-sheet',
    src: '/__agentos/ext/reports/right-sheet.html',
  },
  {
    extensionId: 'notes',
    view: 'page',
    src: '/__agentos/ext/notes/page.html',
  },
];

const extensions: ExtensionEntry[] = [
  {
    id: 'notes',
    name: 'Notes',
    kind: 'customer',
    toggleable: true,
    driven: false,
    rightSheet: { label: 'Inbox', description: 'Recent notes' },
  },
  {
    id: 'reports',
    name: 'Reports',
    kind: 'customer',
    toggleable: true,
    driven: false,
  },
];

describe('resolveRightSheetState', () => {
  test('closed when no id is active', () => {
    const state = resolveRightSheetState({
      activeId: null,
      contributions,
      extensions,
    });
    expect(state.open).toBe(false);
    expect(state.title).toBe('');
    expect(state.frames.every((f) => !f.active)).toBe(true);
  });

  test('only right-sheet contributions become frames', () => {
    const state = resolveRightSheetState({
      activeId: 'notes',
      contributions,
      extensions,
    });
    expect(state.frames.map((f) => f.contribution.extensionId)).toEqual([
      'notes',
      'reports',
    ]);
    expect(
      state.frames.every((f) => f.contribution.view === 'right-sheet'),
    ).toBe(true);
  });

  test('opens the active frame and keeps the others mounted but inactive', () => {
    const state = resolveRightSheetState({
      activeId: 'reports',
      contributions,
      extensions,
    });
    expect(state.open).toBe(true);
    expect(state.frames).toEqual([
      { contribution: contributions[0]!, active: false },
      { contribution: contributions[1]!, active: true },
    ]);
  });

  test('title and description come from rightSheet meta, falling back to name', () => {
    const notes = resolveRightSheetState({
      activeId: 'notes',
      contributions,
      extensions,
    });
    expect(notes.title).toBe('Inbox');
    expect(notes.description).toBe('Recent notes');

    const reports = resolveRightSheetState({
      activeId: 'reports',
      contributions,
      extensions,
    });
    expect(reports.title).toBe('Reports');
    expect(reports.description).toBeUndefined();
  });

  test('never reports open for an id without a right-sheet contribution', () => {
    const state = resolveRightSheetState({
      activeId: 'notes',
      contributions: contributions.filter((c) => c.extensionId !== 'notes'),
      extensions,
    });
    expect(state.open).toBe(false);
    expect(state.frames.every((f) => !f.active)).toBe(true);
  });
});

describe('RightSheetSlot', () => {
  test('renders without throwing when closed or with no contributions', () => {
    expect(() =>
      renderToStaticMarkup(
        <RightSheetSlot
          activeRightSheet={null}
          contributions={contributions}
        />,
      ),
    ).not.toThrow();
    expect(() =>
      renderToStaticMarkup(
        <RightSheetSlot activeRightSheet="notes" contributions={[]} />,
      ),
    ).not.toThrow();
  });
});

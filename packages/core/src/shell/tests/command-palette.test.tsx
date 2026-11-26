import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CommandPaletteSkills,
  isCommandPaletteHotkey,
} from '@agentos/core/shell/components';
import {
  collectEnabledSkills,
  defaultEnabledById,
} from '@agentos/core/shell/lib';
import {
  STUB_EXTENSION_CATALOG,
  STUB_SKILLS_BY_EXTENSION,
} from './fixtures/stub-extension-catalog';

describe('command palette helpers', () => {
  test('isCommandPaletteHotkey detects meta/ctrl+K', () => {
    expect(
      isCommandPaletteHotkey({ key: 'k', metaKey: true, ctrlKey: false }),
    ).toBe(true);
    expect(
      isCommandPaletteHotkey({ key: 'K', metaKey: false, ctrlKey: true }),
    ).toBe(true);
    expect(
      isCommandPaletteHotkey({ key: 'k', metaKey: false, ctrlKey: false }),
    ).toBe(false);
    expect(
      isCommandPaletteHotkey({ key: 'p', metaKey: true, ctrlKey: false }),
    ).toBe(false);
  });

  test('collectEnabledSkills lists stub skills for enabled extensions', () => {
    const items = collectEnabledSkills(
      STUB_SKILLS_BY_EXTENSION,
      defaultEnabledById(STUB_EXTENSION_CATALOG),
      STUB_EXTENSION_CATALOG,
    );
    expect(items.map((i) => i.skill)).toContain('search-contacts');
    expect(items.map((i) => i.skill)).toContain('list-invoices');
    expect(items.find((i) => i.extensionId === 'crm')?.extensionName).toBe(
      'CRM',
    );
  });

  test('collectEnabledSkills omits disabled extensions', () => {
    const enabledById = {
      ...defaultEnabledById(STUB_EXTENSION_CATALOG),
      crm: false,
    };
    const items = collectEnabledSkills(
      STUB_SKILLS_BY_EXTENSION,
      enabledById,
      STUB_EXTENSION_CATALOG,
    );
    expect(items.every((i) => i.extensionId !== 'crm')).toBe(true);
    expect(items.some((i) => i.extensionId === 'invoices')).toBe(true);
  });
});

describe('CommandPaletteSkills', () => {
  test('renders stub skills from props', () => {
    const skills = collectEnabledSkills(
      STUB_SKILLS_BY_EXTENSION,
      defaultEnabledById(STUB_EXTENSION_CATALOG),
      STUB_EXTENSION_CATALOG,
    );
    const html = renderToStaticMarkup(
      createElement(CommandPaletteSkills, { skills }),
    );
    expect(html).toContain('data-slot="command-palette-root"');
    expect(html).toContain('search-contacts');
    expect(html).toContain('create-invoice');
    expect(html).toContain('CRM');
    expect(html).toContain('Invoices');
  });

  test('omits disabled extension skills when passed filtered list', () => {
    const skills = collectEnabledSkills(
      STUB_SKILLS_BY_EXTENSION,
      { ...defaultEnabledById(STUB_EXTENSION_CATALOG), crm: false },
      STUB_EXTENSION_CATALOG,
    );
    const html = renderToStaticMarkup(
      createElement(CommandPaletteSkills, { skills }),
    );
    expect(html).not.toContain('search-contacts');
    expect(html).toContain('list-invoices');
  });
});

import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HitlInbox } from '@agentos/core/shell/components';
import { useShellStore } from '@agentos/core/shell/lib';

describe('HitlInbox', () => {
  test('shows loading state on initial open before fetch resolves', () => {
    useShellStore.setState({ sidebarPanel: 'hitl' });
    const html = renderToStaticMarkup(createElement(HitlInbox));
    expect(html).toContain('data-slot="hitl-inbox"');
    expect(html).toContain('data-loading="true"');
    expect(html).toContain('data-slot="hitl-inbox-loading"');
    expect(html).toContain('Loading approvals');
    expect(html).not.toContain('No pending approvals.');
  });
});

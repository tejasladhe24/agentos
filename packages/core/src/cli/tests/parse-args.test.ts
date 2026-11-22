import { describe, expect, test } from 'bun:test';

import { parseArgs, usage } from '../lib/parse-args';

describe('parseArgs', () => {
  test('parses dev command', () => {
    const parsed = parseArgs(['bun', 'agentos', 'dev']);
    expect(parsed.command).toBe('dev');
    expect(parsed.cwd).toBeUndefined();
    expect(parsed.unknown).toEqual([]);
  });

  test('parses build with --cwd', () => {
    const parsed = parseArgs(['bun', 'agentos', 'build', '--cwd', '/tmp/app']);
    expect(parsed.command).toBe('build');
    expect(parsed.cwd).toBe('/tmp/app');
  });

  test('parses --cwd=value form', () => {
    const parsed = parseArgs(['bun', 'agentos', 'dev', '--cwd=/tmp/app']);
    expect(parsed.command).toBe('dev');
    expect(parsed.cwd).toBe('/tmp/app');
  });

  test('parses create with target and template', () => {
    const parsed = parseArgs([
      'bun',
      'agentos',
      'create',
      'my-app',
      '--template',
      'with-extension',
    ]);
    expect(parsed.command).toBe('create');
    expect(parsed.createTarget).toBe('my-app');
    expect(parsed.template).toBe('with-extension');
    expect(parsed.unknown).toEqual([]);
  });

  test('parses create --template=value before target', () => {
    const parsed = parseArgs([
      'bun',
      'agentos',
      'create',
      '--template=minimal',
      'examples/foo',
    ]);
    expect(parsed.command).toBe('create');
    expect(parsed.createTarget).toBe('examples/foo');
    expect(parsed.template).toBe('minimal');
  });

  test('help flag without command yields help', () => {
    const parsed = parseArgs(['bun', 'agentos', '--help']);
    expect(parsed.command).toBe('help');
    expect(parsed.helpRequested).toBe(true);
  });

  test('collects unknown args', () => {
    const parsed = parseArgs(['bun', 'agentos', 'dev', '--foo']);
    expect(parsed.command).toBe('dev');
    expect(parsed.unknown).toEqual(['--foo']);
  });

  test('parses start with --cwd', () => {
    const parsed = parseArgs(['bun', 'agentos', 'start', '--cwd', '/tmp/app']);
    expect(parsed.command).toBe('start');
    expect(parsed.cwd).toBe('/tmp/app');
    expect(parsed.unknown).toEqual([]);
  });

  test('usage mentions create, dev, build, and start', () => {
    expect(usage()).toContain('create');
    expect(usage()).toContain('dev');
    expect(usage()).toContain('build');
    expect(usage()).toContain('start');
    expect(usage()).toContain('minimal');
    expect(usage()).toContain('Production');
    expect(usage()).toContain('/healthz');
  });
});

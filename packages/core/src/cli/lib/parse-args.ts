/** Parse `agentos` CLI argv into a command + options. */

import { DEFAULT_TEMPLATE, TEMPLATE_IDS } from './template-paths';

export type CliCommand = 'dev' | 'build' | 'start' | 'create' | 'help';

export type ParsedArgs = {
  command: CliCommand | null;
  cwd: string | undefined;
  /** Destination directory for `create`. */
  createTarget: string | undefined;
  /** Template id for `create` (default applied in runCreate). */
  template: string | undefined;
  unknown: string[];
  helpRequested: boolean;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  let command: CliCommand | null = null;
  let cwd: string | undefined;
  let createTarget: string | undefined;
  let template: string | undefined;
  const unknown: string[] = [];
  let helpRequested = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--help' || arg === '-h') {
      helpRequested = true;
      continue;
    }
    if (arg === '--cwd') {
      const value = args[++i];
      if (!value) {
        unknown.push('--cwd');
        continue;
      }
      cwd = value;
      continue;
    }
    if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length) || undefined;
      continue;
    }
    if (arg === '--template') {
      const value = args[++i];
      if (!value) {
        unknown.push('--template');
        continue;
      }
      template = value;
      continue;
    }
    if (arg.startsWith('--template=')) {
      template = arg.slice('--template='.length) || undefined;
      continue;
    }
    if (
      arg === 'dev' ||
      arg === 'build' ||
      arg === 'start' ||
      arg === 'create' ||
      arg === 'help'
    ) {
      if (command === null) {
        command = arg;
      } else {
        unknown.push(arg);
      }
      continue;
    }
    if (
      command === 'create' &&
      createTarget === undefined &&
      !arg.startsWith('-')
    ) {
      createTarget = arg;
      continue;
    }
    unknown.push(arg);
  }

  if (helpRequested && command === null) {
    command = 'help';
  }

  return {
    command,
    cwd,
    createTarget,
    template,
    unknown,
    helpRequested,
  };
}

export function usage(): string {
  const templateList = TEMPLATE_IDS.join(' | ');
  return `Usage: agentos <command> [options]

Commands:
  create  Scaffold a consumer app from templates/ (copy + rename)
  dev     Start Vite Shell, builtin APIs, customer Bun APIs, and Python services
  build   Build the consumer app and required workspace packages
  start   Production entrypoint: builtins + APIs + services + static dist/ gateway
  help    Show this message

Create:
  agentos create <dir> [--template ${DEFAULT_TEMPLATE}]
  Templates: ${templateList}

Start:
  agentos start [--cwd <path>]
  Serves dist/ + gateway on PORT (default 8080). Run agentos build first.
  Sets AGENT_OS_GLOBAL_GATEWAY_URL to http://127.0.0.1:<port> for children.
  GET /healthz reports gateway up (does not probe child processes; fatal
  builtin exits kill the process via ProcessManager).

Options:
  --cwd <path>        Consumer app root for dev/build/start (default: cwd)
  --template <id>     Template for create (default: ${DEFAULT_TEMPLATE})
  -h, --help          Show this message
`;
}

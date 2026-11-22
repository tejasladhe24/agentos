import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** pnpm CLI verbs that are not `pnpm run <script>` and must not be used for package scripts. */
const PNPM_SCRIPT_SHADOWS = new Set([
  'ci',
  'install',
  'i',
  'add',
  'remove',
  'rm',
  'update',
  'up',
  'outdated',
  'list',
  'ls',
  'link',
  'unlink',
  'publish',
  'deploy',
  'dlx',
  'exec',
  'create',
  'init',
  'why',
  'audit',
  'config',
  'store',
  'fetch',
  'import',
  'rebuild',
  'prune',
  'root',
  'bin',
  'env',
  'help',
]);

const ALLOWED_BARE_PNPM = new Set(['install']);

export type DeployWorkflowIssue = {
  command: string;
  message: string;
};

/**
 * Extract top-level `pnpm …` invocations from a GitHub Actions workflow body.
 * Handles `run: pnpm …` and multi-line `run: |` blocks.
 */
export function extractPnpmCommands(workflowSource: string): string[] {
  const commands: string[] = [];
  const lines = workflowSource.split(/\r?\n/);
  let inRunBlock = false;
  let runIndent = 0;

  for (const line of lines) {
    // Matches `run: …` and list form `- run: …`
    const runMatch = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(line);
    if (runMatch) {
      const indent = runMatch[1]?.length ?? 0;
      const rest = (runMatch[2] ?? '').trim();
      if (rest === '|' || rest === '>') {
        inRunBlock = true;
        runIndent = indent;
        continue;
      }
      inRunBlock = false;
      collectPnpmFromLine(rest, commands);
      continue;
    }

    if (inRunBlock) {
      const indent = /^(\s*)/.exec(line)?.[1]?.length ?? 0;
      if (line.trim() === '') continue;
      if (indent <= runIndent) {
        inRunBlock = false;
      } else {
        collectPnpmFromLine(line.trim(), commands);
        continue;
      }
    }
  }

  return commands;
}

function collectPnpmFromLine(line: string, commands: string[]): void {
  // Strip shell noise: if/then wrappers still leave a `pnpm …` token sequence.
  const match = /(?:^|[;&|]\s*|\$\(|`)\s*(pnpm(?:\s+run)?\s+[^\n;&|]+)/.exec(
    ` ${line}`,
  );
  if (!match?.[1]) {
    if (/^pnpm(\s|$)/.test(line)) {
      commands.push(line.trim());
    }
    return;
  }
  commands.push(match[1].trim());
}

/**
 * Validate that deploy workflow pnpm invocations resolve to real package scripts
 * (via `pnpm run`) or an allowlisted bare pnpm builtin (`pnpm install`).
 */
export function checkDeployWorkflowCommands(
  workflowSource: string,
  packageScripts: Record<string, string>,
): DeployWorkflowIssue[] {
  const issues: DeployWorkflowIssue[] = [];
  const scriptNames = new Set(Object.keys(packageScripts));

  for (const command of extractPnpmCommands(workflowSource)) {
    const tokens = command.split(/\s+/).filter(Boolean);
    if (tokens[0] !== 'pnpm') continue;

    if (tokens[1] === 'run') {
      const script = tokens[2];
      if (!script) {
        issues.push({
          command,
          message: 'missing script name after `pnpm run`',
        });
        continue;
      }
      if (!scriptNames.has(script)) {
        issues.push({
          command,
          message: `unknown root package script "${script}"`,
        });
      }
      continue;
    }

    const verb = tokens[1];
    if (!verb) {
      issues.push({ command, message: 'incomplete pnpm invocation' });
      continue;
    }

    if (ALLOWED_BARE_PNPM.has(verb)) {
      continue;
    }

    if (PNPM_SCRIPT_SHADOWS.has(verb) && scriptNames.has(verb)) {
      issues.push({
        command,
        message: `\`pnpm ${verb}\` is a pnpm builtin and will not run package.json scripts.${verb === 'ci' ? ' Use `pnpm run ci`.' : ` Use \`pnpm run ${verb}\`.`}`,
      });
      continue;
    }

    if (scriptNames.has(verb)) {
      issues.push({
        command,
        message: `use \`pnpm run ${verb}\` so package scripts never collide with pnpm builtins`,
      });
      continue;
    }

    if (PNPM_SCRIPT_SHADOWS.has(verb)) {
      issues.push({
        command,
        message: `bare \`pnpm ${verb}\` is not allowlisted for the deploy workflow`,
      });
      continue;
    }

    issues.push({
      command,
      message: `unrecognized pnpm invocation (expected \`pnpm run <script>\` or \`pnpm install\`)`,
    });
  }

  return issues;
}

export function repoRootFromHere(): string {
  return join(import.meta.dir, '..');
}

/** Load workflow + root package.json and return issues (empty = ok). */
export function checkRepoDeployWorkflow(
  root: string = repoRootFromHere(),
): DeployWorkflowIssue[] {
  const workflowPath = join(root, '.github/workflows/deploy-cloudflare.yml');
  const pkgPath = join(root, 'package.json');
  const workflowSource = readFileSync(workflowPath, 'utf8');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return checkDeployWorkflowCommands(workflowSource, pkg.scripts ?? {});
}

if (import.meta.main) {
  const issues = checkRepoDeployWorkflow();
  if (issues.length === 0) {
    console.log('deploy-cloudflare workflow pnpm commands OK');
    process.exit(0);
  }
  console.error('Deploy workflow smoke failed:');
  for (const issue of issues) {
    console.error(`- ${issue.command}: ${issue.message}`);
  }
  process.exit(1);
}

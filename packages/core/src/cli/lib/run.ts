import { formatCreateNextSteps, runCreate } from './create';
import { runBuild } from './build';
import { runDev } from './dev';
import { parseArgs, usage } from './parse-args';
import { runStart } from './start';

export async function main(argv: string[] = Bun.argv): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.unknown.length > 0) {
    console.error(`agentos: unknown argument(s): ${parsed.unknown.join(' ')}`);
    console.error(usage());
    return 1;
  }

  if (parsed.command === null) {
    console.error('agentos: missing command');
    console.error(usage());
    return 1;
  }

  if (parsed.command === 'help' || parsed.helpRequested) {
    console.log(usage());
    return 0;
  }

  try {
    if (parsed.command === 'create') {
      if (!parsed.createTarget) {
        console.error('agentos create: missing <dir>');
        console.error(usage());
        return 1;
      }
      const result = runCreate({
        target: parsed.createTarget,
        template: parsed.template,
        cwd: parsed.cwd ?? process.cwd(),
      });
      console.log(formatCreateNextSteps(result));
      return 0;
    }
    if (parsed.command === 'dev') {
      await runDev({ cwd: parsed.cwd });
      return 0;
    }
    if (parsed.command === 'build') {
      await runBuild({ cwd: parsed.cwd });
      return 0;
    }
    if (parsed.command === 'start') {
      await runStart({ cwd: parsed.cwd });
      return 0;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(message);
    return 1;
  }

  console.error(usage());
  return 1;
}

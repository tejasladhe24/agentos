import { ProcessManager } from './process-manager';
import { resolveConsumerRoot, resolveExtensionsDir } from './resolve-consumer';
import { spawnAgentOsStack } from './spawn-stack';

export type DevOptions = {
  /** Consumer app root override (`--cwd`). */
  cwd?: string;
  /** When false, skip Vite (BFF-only mode for escape hatch). Default true. */
  startVite?: boolean;
  /** Prefix child logs. Default true. */
  prefixLogs?: boolean;
};

/**
 * Start the local AgentOS stack: builtins, customer Bun APIs, Python services,
 * and (by default) the Vite Shell/gateway.
 */
export async function runDev(options: DevOptions = {}): Promise<void> {
  const consumerRoot = resolveConsumerRoot(options.cwd);
  const extensionsDir = resolveExtensionsDir(consumerRoot);
  const startVite = options.startVite !== false;

  const pm = new ProcessManager({ prefixLogs: options.prefixLogs });
  pm.installSignalHandlers();

  console.log(`[agentos] consumer: ${consumerRoot}`);
  spawnAgentOsStack({ consumerRoot, extensionsDir, pm });

  if (startVite) {
    console.log(`[agentos] starting Vite Shell…`);
    pm.spawn({
      name: 'vite',
      cmd: ['bunx', '--bun', 'vite'],
      cwd: consumerRoot,
      fatalOnExit: true,
    });
  }

  if (pm.childCount === 0) {
    console.error('[agentos] nothing to start');
    process.exitCode = 1;
    return;
  }

  await pm.waitForShutdown();
  // Give children a moment; ProcessManager already killed them.
  process.exit(0);
}

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type PythonServiceKind = 'http' | 'worker';

/** Default gateway mount for dual Bun+Python `service` (ticket 83). */
export const DEFAULT_SERVICE_MOUNT = '/_service';

export type ExtensionMeta = {
  api?: {
    language?: string;
    root?: string;
    port?: number;
    kind?: string;
    concurrency?: number;
    timeoutSeconds?: number;
  };
  service?: {
    root?: string;
    port?: number;
    health?: string;
    kind?: string;
    concurrency?: number;
    timeoutSeconds?: number;
    mount?: string;
  };
};

export type BunApiService = {
  id: string;
  serverEntry: string;
  port: number;
};

export type PythonService = {
  id: string;
  resolvedRoot: string;
  port: number;
  /** Defaults to `http` when meta omits kind. */
  kind: PythonServiceKind;
  concurrency?: number;
  timeoutSeconds?: number;
  /**
   * When set, this service is linked beside a Bun API (dual).
   * ProcessManager name should use {@link pythonProcessName}.
   */
  dual?: boolean;
  /** Gateway mount under `/api/ext/:id` (dual only; default `/_service`). */
  mount?: string;
};

/** Env keys injected for worker processes (read by `agentos.worker`). */
export const WORKER_CONCURRENCY_ENV = 'AGENT_OS_WORKER_CONCURRENCY';
export const WORKER_TIMEOUT_SECONDS_ENV = 'AGENT_OS_WORKER_TIMEOUT_SECONDS';

/** ProcessManager child name for a dual-linked Python service. */
export function pythonProcessName(service: Pick<PythonService, 'id' | 'dual'>): string {
  return service.dual ? `${service.id}:service` : service.id;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readMeta(metaPath: string): ExtensionMeta | null {
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8')) as ExtensionMeta;
  } catch {
    return null;
  }
}

function parsePositiveInt(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return undefined;
  }
  return Math.floor(value);
}

function parseServiceKind(raw: unknown): PythonServiceKind {
  return raw === 'worker' ? 'worker' : 'http';
}

function normalizeMount(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw === '/') {
    return DEFAULT_SERVICE_MOUNT;
  }
  return raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

/** Discover customer Bun API servers from extensions/<id>/meta.json. */
export function discoverBunApis(extensionsDir: string): BunApiService[] {
  if (!isDirectory(extensionsDir)) return [];

  const out: BunApiService[] = [];
  for (const id of readdirSync(extensionsDir)) {
    const extDir = join(extensionsDir, id);
    if (!isDirectory(extDir)) continue;
    const metaPath = join(extDir, 'meta.json');
    if (!existsSync(metaPath)) continue;

    const meta = readMeta(metaPath);
    if (!meta) {
      console.warn(`[agentos] skip ${id}: invalid meta.json`);
      continue;
    }
    if (meta.api?.language !== 'bun') continue;
    if (typeof meta.api.port !== 'number') {
      console.warn(`[agentos] skip ${id}: bun meta missing api.port`);
      continue;
    }

    const serverEntry = join(extDir, 'api', 'server.ts');
    if (!existsSync(serverEntry)) {
      console.warn(`[agentos] skip ${id}: missing api/server.ts`);
      continue;
    }

    out.push({ id, serverEntry, port: meta.api.port });
  }
  return out;
}

function pushPythonService(
  out: PythonService[],
  id: string,
  extDir: string,
  opts: {
    root: string;
    port: number;
    kindRaw: unknown;
    concurrency: unknown;
    timeoutSeconds: unknown;
    dual?: boolean;
    mount?: string;
  },
): void {
  const resolvedRoot = resolve(extDir, opts.root);
  if (!isDirectory(resolvedRoot)) {
    console.warn(
      `[agentos] skip ${id}: python service root missing: ${resolvedRoot}`,
    );
    return;
  }

  const kind = parseServiceKind(opts.kindRaw);
  const concurrency = parsePositiveInt(opts.concurrency);
  const timeoutSeconds = parsePositiveInt(opts.timeoutSeconds);

  if (
    opts.kindRaw != null &&
    opts.kindRaw !== 'http' &&
    opts.kindRaw !== 'worker'
  ) {
    console.warn(
      `[agentos] ${id}: unknown api.kind "${String(opts.kindRaw)}" — treating as http`,
    );
  }

  out.push({
    id,
    resolvedRoot,
    port: opts.port,
    kind,
    ...(concurrency !== undefined ? { concurrency } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(opts.dual ? { dual: true } : {}),
    ...(opts.mount ? { mount: opts.mount } : {}),
  });
}

/** Discover customer Python services from extensions/<id>/meta.json. */
export function discoverPythonServices(extensionsDir: string): PythonService[] {
  if (!isDirectory(extensionsDir)) return [];

  const out: PythonService[] = [];
  for (const id of readdirSync(extensionsDir)) {
    const extDir = join(extensionsDir, id);
    if (!isDirectory(extDir)) continue;
    const metaPath = join(extDir, 'meta.json');
    if (!existsSync(metaPath)) continue;

    const meta = readMeta(metaPath);
    if (!meta) {
      console.warn(`[agentos] skip ${id}: invalid meta.json`);
      continue;
    }

    // Dual: Bun api + sibling service block (ticket 83)
    if (meta.api?.language === 'bun' && meta.service) {
      if (typeof meta.service.root !== 'string' || !meta.service.root) {
        console.warn(`[agentos] skip ${id}: service missing root`);
        continue;
      }
      if (typeof meta.service.port !== 'number') {
        console.warn(`[agentos] skip ${id}: service missing port`);
        continue;
      }
      if (meta.service.port === meta.api.port) {
        console.warn(
          `[agentos] skip ${id}:service — port collides with api.port (${meta.api.port})`,
        );
        continue;
      }
      pushPythonService(out, id, extDir, {
        root: meta.service.root,
        port: meta.service.port,
        kindRaw: meta.service.kind,
        concurrency: meta.service.concurrency,
        timeoutSeconds: meta.service.timeoutSeconds,
        dual: true,
        mount: normalizeMount(meta.service.mount),
      });
      continue;
    }

    if (meta.api?.language !== 'python') continue;
    if (meta.service) {
      console.warn(
        `[agentos] ${id}: meta.service ignored when api.language is python — use api.root`,
      );
    }
    if (typeof meta.api.root !== 'string' || !meta.api.root) {
      console.warn(`[agentos] skip ${id}: python meta missing api.root`);
      continue;
    }
    if (typeof meta.api.port !== 'number') {
      console.warn(`[agentos] skip ${id}: python meta missing api.port`);
      continue;
    }

    pushPythonService(out, id, extDir, {
      root: meta.api.root,
      port: meta.api.port,
      kindRaw: meta.api.kind,
      concurrency: meta.api.concurrency,
      timeoutSeconds: meta.api.timeoutSeconds,
    });
  }
  return out;
}

/**
 * Env vars for a worker process (concurrency + timeout).
 * HTTP services get an empty object.
 */
export function workerProcessEnv(
  service: Pick<PythonService, 'kind' | 'concurrency' | 'timeoutSeconds'>,
): Record<string, string> {
  if (service.kind !== 'worker') return {};
  const env: Record<string, string> = {};
  if (service.concurrency !== undefined) {
    env[WORKER_CONCURRENCY_ENV] = String(service.concurrency);
  }
  if (service.timeoutSeconds !== undefined) {
    env[WORKER_TIMEOUT_SECONDS_ENV] = String(service.timeoutSeconds);
  }
  return env;
}

function pythonHasUvicorn(pythonBin: string): boolean {
  const result = Bun.spawnSync([pythonBin, '-c', 'import uvicorn'], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return result.exitCode === 0;
}

export type ResolvedPythonCmd = {
  cmd: string[];
  env: Record<string, string>;
};

/**
 * Resolve uvicorn launch command for a Python service.
 * Prefers service/.venv or packages/python/.venv; falls back to `uv run`.
 */
export function resolvePythonCmd(
  serviceRoot: string,
  repoRoot: string,
  baseEnv: Record<string, string>,
): ResolvedPythonCmd | null {
  const agentosPython = join(repoRoot, 'packages/python');
  const serviceVenvPython = join(serviceRoot, '.venv/bin/python');
  const kitVenvPython = join(agentosPython, '.venv/bin/python');
  const pythonPathEnv = {
    ...baseEnv,
    PYTHONPATH: [agentosPython, serviceRoot, Bun.env.PYTHONPATH]
      .filter(Boolean)
      .join(':'),
  };

  const candidates = [serviceVenvPython, kitVenvPython].filter(
    (bin) => existsSync(bin) && pythonHasUvicorn(bin),
  );

  if (candidates.length > 0) {
    return {
      cmd: [
        candidates[0]!,
        '-m',
        'uvicorn',
        'app.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        'PORT',
      ],
      env: pythonPathEnv,
    };
  }

  const uv = Bun.which('uv');
  if (uv) {
    return {
      cmd: [
        uv,
        'run',
        'uvicorn',
        'app.main:app',
        '--host',
        '127.0.0.1',
        '--port',
        'PORT',
      ],
      env: baseEnv,
    };
  }

  return null;
}

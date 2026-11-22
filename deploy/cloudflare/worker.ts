/**
 * Thin Cloudflare adapter: proxy HTTPS → one Container running `agentos start` on 8080.
 *
 * Uses the Durable Object Container API (`ctx.container`) — `@cloudflare/containers`
 * is deprecated. No AgentOS domain logic lives here; delete this folder to migrate hosts.
 */
import { DurableObject } from 'cloudflare:workers';

import { collectContainerEnv } from './lib/forward-env';

const CONTAINER_PORT = 8080;
const SINGLETON_NAME = 'agentos';
/** Keep the singleton warm a bit after traffic stops (cold start of the full image is costly). */
const INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000;
const READY_PATH = '/healthz';
const READY_ATTEMPTS = 150;
const READY_INTERVAL_MS = 400;

export class AgentOsContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;
  private monitoring: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS),
      );
      this.observeExit();
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const container = this.ctx.container;
    if (!container) {
      return new Response('Container binding missing', { status: 500 });
    }

    const url = new URL(request.url);
    url.protocol = 'http:';
    url.host = 'container';
    const forwarded = new Request(url, request);
    forwarded.headers.delete('host');
    return container.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container;
    if (!container) {
      throw new Error('No container is configured for this Durable Object');
    }

    if (!container.running) {
      // default scheduling policy: image + instance_type come from wrangler.jsonc.
      // enableInternet required when passing options; AgentOS needs Neon / R2 / AI egress.
      container.start({
        enableInternet: true,
        env: collectContainerEnv(
          this.env as unknown as Record<string, unknown>,
        ),
      });
    }

    this.observeExit();
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < READY_ATTEMPTS; attempt++) {
      try {
        const response = await port.fetch(`http://container${READY_PATH}`, {
          signal: AbortSignal.timeout(2000),
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`Health check returned ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(READY_INTERVAL_MS);
    }

    throw new Error(
      `Container did not become ready on port ${CONTAINER_PORT}`,
      {
        cause: lastError,
      },
    );
  }

  private observeExit(): void {
    if (this.monitoring) return;
    const container = this.ctx.container;
    if (!container) return;

    this.monitoring = container
      .monitor()
      .then(() => console.log('AgentOS container exited'))
      .catch((error: unknown) =>
        console.error('AgentOS container failed:', error),
      )
      .finally(() => {
        this.monitoring = undefined;
      });
    this.ctx.waitUntil(this.monitoring);
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    // Singleton DO → one container (wrangler max_instances: 1).
    return env.AGENT_OS_CONTAINER.getByName(SINGLETON_NAME).fetch(request);
  },
} satisfies ExportedHandler<Env>;

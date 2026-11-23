import { runErrorHooks, runRequestHooks, runResponseHooks } from './hooks';
import { createContext } from './create-context';
import { matchRoute } from './match-route';
import { createDefaultAccessMiddleware } from './public-token';
import type {
  App,
  AppContext,
  Handler,
  HttpMethod,
  Middleware,
  RouteRegistration,
} from './types';

const METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'HEAD',
];

/** Options for {@link createApp} when an extension declares public/open API prefixes. */
export type CreateAppOptions = {
  /**
   * When non-empty (alone or with {@link CreateAppOptions.openApiPrefixes}),
   * every route except `GET /health` is default-deny: paths under these
   * prefixes require a signed public token; all others require a session
   * (unless listed in `openApiPrefixes`).
   */
  publicApiPrefixes?: string[];
  /**
   * Path prefixes that skip session and public-token gates (OAuth callbacks,
   * inbound webhooks — ticket 78). Enabling this (or `publicApiPrefixes`)
   * turns on default-deny for the rest of the app.
   */
  openApiPrefixes?: string[];
};

/**
 * Bun-native app factory with a built-in `GET /health` → `{ ok: true }`.
 * File routes registered later via `loadRoutes` (or `app.route`) can override health.
 *
 * Lifecycle hooks from `@agentos/core/api/hooks` run automatically for
 * onRequest / onResponse / onError. Call `runStartHooks()` before Bun.serve.
 *
 * Pass `publicApiPrefixes` (from `meta.json` `public.apiPrefixes`) and/or
 * `openApiPrefixes` (OAuth callbacks / webhooks) to enable default-deny auth.
 */
export function createApp(options: CreateAppOptions = {}): App {
  const routes: RouteRegistration[] = [];
  const publicApiPrefixes = options.publicApiPrefixes?.filter(Boolean) ?? [];
  const openApiPrefixes = options.openApiPrefixes?.filter(Boolean) ?? [];
  const defaultAccess =
    publicApiPrefixes.length > 0 || openApiPrefixes.length > 0
      ? createDefaultAccessMiddleware(publicApiPrefixes, { openApiPrefixes })
      : null;

  const app: App = {
    route(method, pattern, handler, middleware = []) {
      const normalized = normalizePattern(pattern);
      // Later registrations win (e.g. file route overrides built-in health).
      const existing = routes.findIndex(
        (r) => r.method === method && r.pattern === normalized,
      );
      const isBuiltInHealth = method === 'GET' && normalized === '/health';
      const gatedMiddleware =
        defaultAccess && !isBuiltInHealth
          ? [defaultAccess, ...middleware]
          : middleware;
      const entry: RouteRegistration = {
        method,
        pattern: normalized,
        handler,
        middleware: gatedMiddleware,
      };
      if (existing >= 0) {
        routes[existing] = entry;
      } else {
        routes.push(entry);
      }
    },

    async fetch(request: Request): Promise<Response> {
      const early = await runRequestHooks(request);
      if (early) {
        return early;
      }

      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, '') || '/';
      const method = request.method.toUpperCase() as HttpMethod;

      if (!METHODS.includes(method)) {
        return new Response('Method Not Allowed', { status: 405 });
      }

      let matched: RouteRegistration | undefined;
      let params: Record<string, string> = {};
      let pathMatchedWithoutMethod = false;

      for (const route of routes) {
        const found = matchRoute(route.pattern, pathname);
        if (found === null) continue;
        pathMatchedWithoutMethod = true;
        if (route.method === method) {
          matched = route;
          params = found;
          break;
        }
      }

      if (!matched) {
        if (pathMatchedWithoutMethod) {
          return new Response('Method Not Allowed', { status: 405 });
        }
        return new Response('Not Found', { status: 404 });
      }

      const c = createContext(request, params);
      try {
        const response = await runMiddleware(matched.middleware, c, () =>
          matched!.handler(c),
        );
        return await runResponseHooks(request, response, c);
      } catch (error) {
        const hooked = await runErrorHooks(error, request, c);
        if (hooked) {
          return hooked;
        }
        throw error;
      }
    },
  };

  app.route('GET', '/health', (c) => c.json({ ok: true }));

  return app;
}

async function runMiddleware(
  middleware: Middleware[],
  c: AppContext,
  handler: () => Response | Promise<Response>,
): Promise<Response> {
  let index = -1;

  const dispatch = async (i: number): Promise<Response> => {
    if (i <= index) {
      throw new Error('next() called multiple times');
    }
    index = i;
    if (i === middleware.length) {
      return handler();
    }

    const fn = middleware[i]!;
    let nextCalled = false;
    let nextResponse: Response | undefined;

    const next = async (): Promise<Response> => {
      nextCalled = true;
      nextResponse = await dispatch(i + 1);
      return nextResponse;
    };

    const result = await fn(c, next);
    if (result instanceof Response) {
      return result;
    }
    if (!nextCalled) {
      return dispatch(i + 1);
    }
    return nextResponse!;
  };

  return dispatch(0);
}

function normalizePattern(pattern: string): string {
  if (!pattern.startsWith('/')) {
    pattern = `/${pattern}`;
  }
  return pattern.replace(/\/+$/, '') || '/';
}

/** @internal — re-export for convenience. */
export type { Handler, Middleware };

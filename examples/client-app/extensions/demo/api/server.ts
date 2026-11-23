import { createApp, loadRoutes } from '@agentos/core/api';

const PORT = 6103;

const app = createApp({
  publicApiPrefixes: ['/portal/'],
});
await loadRoutes(app, `${import.meta.dir}/routes`);

const server = Bun.serve({
  port: PORT,
  fetch: app.fetch,
});

console.log(
  `[agentos demo] listening on http://127.0.0.1:${server.port} (proxy /api/ext/demo/*)`,
);

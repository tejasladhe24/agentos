import { parseExtHtmlPath, renderExtHtmlEntry } from './html-entry';
import { plainResponse, requestPathname } from './http';
import type { GatewayHandler, RegistryModel, UiViewName } from './types';

/**
 * Serve `/__agentos/ext/<id>/<view>.html` iframe entry documents.
 */
export function createExtHtmlHandler(
  getModel: () => RegistryModel,
  scriptSrcFor: (extensionId: string, view: UiViewName) => string,
): GatewayHandler {
  return (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return null;
    }
    const pathname = requestPathname(request);
    const parsed = parseExtHtmlPath(pathname);
    if (!parsed) {
      return null;
    }

    const filePath = getModel().extensions.find(
      (ext) => ext.id === parsed.extensionId,
    )?.ui[parsed.view];

    if (!filePath) {
      return plainResponse(
        404,
        `AgentOS extension view not found: ${parsed.extensionId}/${parsed.view}`,
      );
    }

    const html = renderExtHtmlEntry({
      extensionId: parsed.extensionId,
      view: parsed.view,
      scriptSrc: scriptSrcFor(parsed.extensionId, parsed.view),
    });
    const headers = { 'Content-Type': 'text/html; charset=utf-8' };
    if (request.method === 'HEAD') {
      return new Response(null, { status: 200, headers });
    }
    return new Response(html, { status: 200, headers });
  };
}

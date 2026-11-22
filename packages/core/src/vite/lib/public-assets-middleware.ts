import {
  PUBLIC_ASSETS_PREFIX,
  createPublicAssetsHandler,
  parsePublicAssetPath,
  pathUnderRoot,
  publicAssetNotFoundHtml,
  resolvePublicAssetFile,
  resolvePublicRoot,
} from '@agentos/core/gateway/lib/index';
import { toConnectMiddleware, type ConnectMiddleware } from './connect-adapter';

export {
  PUBLIC_ASSETS_PREFIX,
  parsePublicAssetPath,
  pathUnderRoot,
  publicAssetNotFoundHtml,
  resolvePublicAssetFile,
  resolvePublicRoot,
};

/**
 * Serve consumer `public/` files at `/_public/<path>` (Vite Connect adapter).
 */
export function createPublicAssetsMiddleware(
  getPublicRoot: () => string,
): ConnectMiddleware {
  return toConnectMiddleware(createPublicAssetsHandler(getPublicRoot));
}

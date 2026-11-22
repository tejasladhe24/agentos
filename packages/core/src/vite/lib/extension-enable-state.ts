import {
  applyExtensionEnable,
  createExtensionEnableHandler,
  createExtensionEnableState,
  handleExtensionEnableRequest,
  isLockedExtension,
  parseEnabledFlag,
  parseExtensionEnablePath,
  type ApplyEnableResult,
  type ExtensionEnableState,
} from '@agentos/core/gateway/lib/index';
import type { RegistryModel } from './types';
import { toConnectMiddleware, type ConnectMiddleware } from './connect-adapter';

export type { ApplyEnableResult, ConnectMiddleware, ExtensionEnableState };
export {
  applyExtensionEnable,
  createExtensionEnableState,
  handleExtensionEnableRequest,
  isLockedExtension,
  parseEnabledFlag,
  parseExtensionEnablePath,
};

/**
 * Connect middleware: `POST /api/extensions/:id/enable` with `{ enabled: boolean }`.
 * Thin adapter over the portable fetch handler.
 */
export function createExtensionEnableMiddleware(
  getModel: () => RegistryModel,
  state: ExtensionEnableState,
): ConnectMiddleware {
  return toConnectMiddleware(createExtensionEnableHandler(getModel, state));
}

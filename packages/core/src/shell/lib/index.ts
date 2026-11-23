export {
  ACTIVITY_BAR_STORAGE_KEY,
  readStoredActivity,
  restoreStoredActivity,
  writeStoredActivity,
  type StoredActivitySelection,
} from './chrome/activity-bar-persistence';
export { applyBranding, isFontUrl } from './chrome/apply-branding';
export {
  AUTH_API_BASE,
  fetchAuthSession,
  requestPasswordReset,
  resetPasswordWithToken,
  signInWithEmail,
  signOutSession,
  signUpWithEmail,
  type AuthSessionOk,
  type AuthSessionView,
} from './auth/auth-api';
export {
  collectPublicExtensionRoutes,
  isKnownAppPath,
  isPublicAuthPath,
  loginPathWithNext,
  matchPublicAuthRoute,
  matchPublicExtensionRoute,
  navigateApp,
  normalizePathname,
  readNextParam,
  readResetToken,
  type AuthRouteFlags,
  type PublicAuthRoute,
  type PublicExtensionRoute,
} from './auth/auth-routes';
export {
  applyRegistry,
  hydrateEnableStateFromGateway,
  mapRegistry,
  type AppliedRegistry,
} from './chrome/apply-registry';
export {
  buildActivityBarSections,
  type ActivityBarItem,
  type ActivityBarSections,
  type ActivityBarShellPanel,
} from './chrome/build-activity-bar-items';
export {
  contributionKey,
  type ContributionRuntimeStatus,
  type ExtensionView,
  type UiContribution,
} from './ui-contribs/contribution';
export {
  sidebarColumnHasContent,
  sidebarColumnVisible,
  type SidebarColumnContentInput,
  type SidebarColumnVisibleInput,
} from './ui-contribs/sidebar-column-visible';
export {
  createShellHostApi,
  resetShellHostApiStorage,
} from './chrome/create-shell-host-api';
export {
  collectEnabledSkills,
  defaultEnabledById,
  defaultSkillsByExtension,
  resolveActivityBarSection,
  STUB_EXTENSION_CATALOG,
  STUB_SKILLS_BY_EXTENSION,
  type ActivityBarSection,
  type ExtensionEntry,
  type ExtensionKind,
  type ExtensionManagerStatus,
  type PaletteSkill,
} from './chrome/extension-catalog';
export {
  requestExtensionEnable,
  requestExtensionEnableState,
} from './chrome/extension-enable';
export {
  activateFrame,
  deactivateFrame,
  listenForReady,
  type ActivatedFrame,
  type ActivateFrameOptions,
} from './ui-contribs/extension-runtime';
export { deriveExtensionManagerStatus } from './ui-contribs/extension-status';
export {
  DEFAULT_EXTENSION_ICON,
  EXTENSION_ICON_MAP,
  normalizeExtensionIconName,
  resolveExtensionIcon,
  type ExtensionIconName,
} from './chrome/resolve-extension-icon';
export {
  useShellStore,
  type ChatMessage,
  type ShellUiState,
  type ShellView,
  type SidebarPanel,
} from './chrome/store';
export { withThemeQuery } from './ui-contribs/with-theme-query';

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
  registerAppNavigator,
  type AuthRouteFlags,
  type PublicAuthRoute,
  type PublicExtensionRoute,
} from './auth/auth-routes';
export {
  createRouteStoreSync,
  storeTarget,
  type RouteHistory,
  type RouteStoreSync,
} from './routing/route-store-sync';
export {
  parseSearchString,
  stringifySearchRecord,
  type SearchRecord,
} from './routing/search';
export {
  EXTENSION_PATH_PREFIX,
  pathToView,
  targetFromLocation,
  targetHref,
  targetsEqual,
  viewToPath,
  type RouteTarget,
} from './routing/view-paths';
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
} from './chrome/build-activity-bar-items';
export {
  pushThemeToFrame,
  type ThemeEventRemote,
} from './ui-contribs/push-theme';
export {
  contributionKey,
  filterContributions,
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
  rightSidebarColumnHasContent,
  rightSidebarColumnVisible,
  type RightSidebarColumnContentInput,
  type RightSidebarColumnVisibleInput,
} from './ui-contribs/right-sidebar-column-visible';
export {
  createShellHostApi,
  resetShellHostApiStorage,
  type CreateShellHostApiOptions,
} from './chrome/create-shell-host-api';
export {
  createShellEventBus,
  EventDeclarationError,
  type EventDeclarations,
  type EventDeliver,
  type ShellEventBus,
} from './chrome/event-bus';
export {
  canPermission,
  errorMessageFromBody,
  extensionIdOfPath,
  filesBlobUrl,
  mayCallExtension,
  resetPermissionCache,
} from './chrome/platform-capabilities';
export {
  createEventsBridge,
  EVENTS_SUBSCRIBE_URL,
  type EventSourceLike,
  type EventsBridge,
  type EventsBridgeOptions,
} from './chrome/events-bridge';
export {
  HITL_FALLBACK_POLL_MS,
  HITL_WAIT_TIMEOUT_MS,
  waitForApproval,
  type ApprovalStatus,
  type WaitForApprovalDeps,
} from './chrome/hitl-wait';
export {
  disposeEventsBridge,
  ensureEventsBridge,
  shellEventBus,
} from './chrome/shell-event-bus';
export {
  collectEnabledSkills,
  defaultEnabledById,
  defaultSkillsByExtension,
  resolveActivityBarSection,
  STUB_EXTENSION_CATALOG,
  STUB_SKILLS_BY_EXTENSION,
  type ActivityBarSection,
  type ExtensionEntry,
  type ExtensionEventDeclarations,
  type ExtensionKind,
  type ExtensionManagerStatus,
  type ExtensionSettingsEntry,
  type ExtensionSettingsSection,
  type PaletteSkill,
} from './chrome/extension-catalog';
export {
  readStoredSettingsKey,
  resolveActiveSettingsItem,
  SETTINGS_SELECTED_KEY,
  writeStoredSettingsKey,
} from './settings/settings-selection';
export {
  buildSettingsItems,
  filterSettingsItems,
  groupSettingsItems,
  searchSettings,
  type SettingsEntryItem,
  type SettingsNavGroup,
  type SettingsNavItem,
  type SettingsSearchResult,
} from './settings/build-settings-items';
export { fuzzyScore, type FuzzyField } from './settings/fuzzy';
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
export {
  deriveExtensionManagerStatus,
  shouldShowExtensionFrameLoading,
} from './ui-contribs/extension-status';
export {
  DEFAULT_EXTENSION_ICON,
  EXTENSION_ICON_MAP,
  normalizeExtensionIconName,
  resolveExtensionIcon,
  type ExtensionIconName,
} from './chrome/resolve-extension-icon';
export {
  isAdminRoles,
  useShellStore,
  type ChatMessage,
  type ShellUiState,
  type ShellView,
} from './chrome/store';
export { withThemeQuery } from './ui-contribs/with-theme-query';

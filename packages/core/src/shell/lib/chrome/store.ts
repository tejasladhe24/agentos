import { create } from 'zustand';
import type { NotificationType } from '@agentos/core/sdk';
import {
  contributionKey,
  type ContributionRuntimeStatus,
  type UiContribution,
} from '../ui-contribs/contribution';
import { defaultEnabledById, type ExtensionEntry } from './extension-catalog';
import { requestExtensionEnable } from './extension-enable';

export type ShellView = 'home' | (string & {});

/** What the left SidebarSlot hosts (ticket 39 — no right Sheets). */
export type SidebarPanel = 'contribution' | 'extensions' | 'hitl';

function filterContributions(
  desired: UiContribution[],
  enabledById: Record<string, boolean>,
): UiContribution[] {
  return desired.filter((c) => enabledById[c.extensionId] !== false);
}

function filterSkills(
  desired: Record<string, string[]>,
  enabledById: Record<string, boolean>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [extensionId, skills] of Object.entries(desired)) {
    if (enabledById[extensionId] !== false) {
      out[extensionId] = [...skills];
    }
  }
  return out;
}

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};

export type ShellUiState = {
  activeView: ShellView;
  sidebarOpen: boolean;
  /** Left sidebar host mode — Shell panels or active extension contribution. */
  sidebarPanel: SidebarPanel;
  chatOpen: boolean;
  chatMessages: ChatMessage[];
  chatBusy: boolean;
  /** Catalog entries shown in Extension Manager (from registry). */
  extensions: ExtensionEntry[];
  /** Per-extension enable flag; builtins stay true. */
  enabledById: Record<string, boolean>;
  /**
   * Desired UI contributions (all known mounts).
   * `contributions` is the enabled subset actually mounted.
   */
  desiredContributions: UiContribution[];
  contributions: UiContribution[];
  runtimeStatus: Record<string, ContributionRuntimeStatus>;
  /** All known skills from the registry (before enable filtering). */
  desiredSkillsByExtension: Record<string, string[]>;
  /** Skills contributed per enabled extension (palette wiring). */
  skillsByExtension: Record<string, string[]>;
  /** Latest notification / status line for the status bar. */
  statusText: string | null;
  statusTone: NotificationType | null;
  setActiveView: (view: ShellView) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarPanel: (panel: SidebarPanel) => void;
  setChatOpen: (open: boolean) => void;
  toggleChat: () => void;
  appendChatMessage: (message: ChatMessage) => void;
  setChatBusy: (busy: boolean) => void;
  toggleSidebar: () => void;
  setExtensions: (extensions: ExtensionEntry[]) => void;
  setContributions: (contributions: UiContribution[]) => void;
  setDesiredSkills: (skillsByExtension: Record<string, string[]>) => void;
  setRuntimeStatus: (
    extensionId: string,
    view: UiContribution['view'],
    status: ContributionRuntimeStatus,
  ) => void;
  setExtensionSkills: (extensionId: string, skills: string[]) => void;
  setExtensionEnabled: (extensionId: string, enabled: boolean) => void;
  /**
   * Merge gateway enable overrides into local state (ticket 60 reload hydrate).
   * Locked / non-toggleable extensions stay enabled.
   */
  hydrateEnabledById: (overrides: Record<string, boolean>) => void;
  setStatusText: (text: string | null, tone?: NotificationType | null) => void;
};

export const useShellStore = create<ShellUiState>((set, get) => ({
  activeView: 'home',
  sidebarOpen: true,
  sidebarPanel: 'contribution',
  chatOpen: false,
  chatMessages: [],
  chatBusy: false,
  extensions: [],
  enabledById: {},
  desiredContributions: [],
  contributions: [],
  runtimeStatus: {},
  desiredSkillsByExtension: {},
  skillsByExtension: {},
  statusText: null,
  statusTone: null,
  setActiveView: (view) =>
    set({
      activeView: view,
      sidebarPanel: 'contribution',
    }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarPanel: (panel) =>
    set(
      panel === 'contribution'
        ? { sidebarPanel: 'contribution' }
        : { sidebarPanel: panel, sidebarOpen: true },
    ),
  setChatOpen: (open) => set({ chatOpen: open }),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  appendChatMessage: (message) =>
    set((s) => ({ chatMessages: [...s.chatMessages, message] })),
  setChatBusy: (busy) => set({ chatBusy: busy }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setExtensions: (extensions) =>
    set((s) => {
      const enabledById = {
        ...defaultEnabledById(extensions),
        ...s.enabledById,
      };
      for (const ext of extensions) {
        if (!ext.toggleable) enabledById[ext.id] = true;
        if (enabledById[ext.id] === undefined) enabledById[ext.id] = true;
      }
      return {
        extensions,
        enabledById,
        contributions: filterContributions(s.desiredContributions, enabledById),
        skillsByExtension: filterSkills(
          s.desiredSkillsByExtension,
          enabledById,
        ),
      };
    }),
  setContributions: (desiredContributions) =>
    set((s) => ({
      desiredContributions,
      contributions: filterContributions(desiredContributions, s.enabledById),
    })),
  setDesiredSkills: (desiredSkillsByExtension) =>
    set((s) => ({
      desiredSkillsByExtension,
      skillsByExtension: filterSkills(desiredSkillsByExtension, s.enabledById),
    })),
  setRuntimeStatus: (extensionId, view, status) =>
    set((s) => ({
      runtimeStatus: {
        ...s.runtimeStatus,
        [contributionKey(extensionId, view)]: status,
      },
    })),
  setExtensionSkills: (extensionId, skills) =>
    set((s) => {
      const desiredSkillsByExtension = {
        ...s.desiredSkillsByExtension,
        [extensionId]: skills,
      };
      return {
        desiredSkillsByExtension,
        skillsByExtension: filterSkills(
          desiredSkillsByExtension,
          s.enabledById,
        ),
      };
    }),
  setStatusText: (text, tone = null) =>
    set({
      statusText: text,
      statusTone: text == null ? null : (tone ?? null),
    }),
  setExtensionEnabled: (extensionId, enabled) => {
    const entry = get().extensions.find((e) => e.id === extensionId);
    if (!entry || !entry.toggleable) return;

    set((s) => {
      const enabledById = { ...s.enabledById, [extensionId]: enabled };
      const runtimeStatus = { ...s.runtimeStatus };
      if (!enabled) {
        for (const key of Object.keys(runtimeStatus)) {
          if (key.startsWith(`${extensionId}:`)) {
            delete runtimeStatus[key];
          }
        }
      }
      return {
        enabledById,
        skillsByExtension: filterSkills(
          s.desiredSkillsByExtension,
          enabledById,
        ),
        runtimeStatus,
        contributions: filterContributions(s.desiredContributions, enabledById),
      };
    });

    void requestExtensionEnable(extensionId, enabled);
  },
  hydrateEnabledById: (overrides) => {
    set((s) => {
      const enabledById = { ...s.enabledById, ...overrides };
      for (const ext of s.extensions) {
        if (!ext.toggleable) {
          enabledById[ext.id] = true;
        }
      }
      const runtimeStatus = { ...s.runtimeStatus };
      for (const [extensionId, enabled] of Object.entries(enabledById)) {
        if (enabled === false) {
          for (const key of Object.keys(runtimeStatus)) {
            if (key.startsWith(`${extensionId}:`)) {
              delete runtimeStatus[key];
            }
          }
        }
      }
      return {
        enabledById,
        runtimeStatus,
        skillsByExtension: filterSkills(
          s.desiredSkillsByExtension,
          enabledById,
        ),
        contributions: filterContributions(s.desiredContributions, enabledById),
      };
    });
  },
}));

import type { AnalysisReport, ProcessInfo, ProfileRuntimeState, RecentWorkspace, RunProfile, RuntimeSession, WorkspaceSummary } from "../types/workspace";

declare global {
  interface Window {
    go?: {
      main?: {
        App?: {
          OpenWorkspaceDialog: () => Promise<string>;
          InspectWorkspace: (root: string) => Promise<WorkspaceSummary>;
          ListRecentWorkspaces: () => Promise<RecentWorkspace[]>;
          RunCommand: (workDir: string, command: string) => Promise<ProcessInfo>;
          StopCommand: (processId: string) => Promise<void>;
          RestartCommand: (processId: string) => Promise<ProcessInfo>;
          ListProcesses: () => Promise<ProcessInfo[]>;
          AnalyzeWorkspace: (root: string) => Promise<AnalysisReport>;
          CloseApp: () => Promise<void>;
          ListProfiles: () => Promise<RunProfile[]>;
          SaveProfile: (profile: RunProfile) => Promise<void>;
          DeleteProfile: (profileID: string) => Promise<void>;
          RunProfile: (profileID: string) => Promise<ProcessInfo[]>;
          GetProfileRuntimeState: (profileID: string) => Promise<ProfileRuntimeState>;
          ListProfileRuntimeStates: () => Promise<ProfileRuntimeState[]>;
          StopProfile: (profileID: string) => Promise<void>;
          GetLastRuntimeSession: (root: string) => Promise<RuntimeSession>;
          RestoreRuntimeSession: (root: string) => Promise<ProcessInfo[]>;
        };
      };
    };
    runtime?: {
      EventsOn: (name: string, cb: (payload: unknown) => void) => () => void;
    };
  }
}

function appApi() {
  const api = window.go?.main?.App;
  if (!api) {
    throw new Error("Wails API unavailable. Run via Wails runtime.");
  }
  return api;
}

export const wailsService = {
  openWorkspaceDialog: () => appApi().OpenWorkspaceDialog(),
  inspectWorkspace: (root: string) => appApi().InspectWorkspace(root),
  listRecentWorkspaces: () => appApi().ListRecentWorkspaces(),
  runCommand: (workDir: string, command: string) => appApi().RunCommand(workDir, command),
  stopCommand: (processId: string) => appApi().StopCommand(processId),
  restartCommand: (processId: string) => appApi().RestartCommand(processId),
  listProcesses: () => appApi().ListProcesses(),
  analyzeWorkspace: (root: string) => appApi().AnalyzeWorkspace(root),
  closeApp: () => appApi().CloseApp(),
  listProfiles: () => appApi().ListProfiles(),
  saveProfile: (profile: RunProfile) => appApi().SaveProfile(profile),
  deleteProfile: (profileID: string) => appApi().DeleteProfile(profileID),
  runProfile: (profileID: string) => appApi().RunProfile(profileID),
  getProfileRuntimeState: (profileID: string) => appApi().GetProfileRuntimeState(profileID),
  listProfileRuntimeStates: () => appApi().ListProfileRuntimeStates(),
  stopProfile: (profileID: string) => appApi().StopProfile(profileID),
  getLastRuntimeSession: (root: string) => appApi().GetLastRuntimeSession(root),
  restoreRuntimeSession: (root: string) => appApi().RestoreRuntimeSession(root),
  onLog: (cb: (payload: unknown) => void) => {
    if (!window.runtime?.EventsOn) {
      return () => undefined;
    }
    return window.runtime.EventsOn("process:log", cb);
  },
  onProcessUpdated: (cb: (payload: unknown) => void) => {
    if (!window.runtime?.EventsOn) {
      return () => undefined;
    }
    return window.runtime.EventsOn("process:updated", cb);
  },
};

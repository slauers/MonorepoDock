import { create } from "zustand";
import { wailsService } from "../services/wails";
import type {
  AffectedReport,
  AnalysisReport,
  DependencyReport,
  LogEntry,
  ProcessInfo,
  RecentWorkspace,
  Target,
  WorkspaceSummary,
} from "../types/workspace";

type WorkspaceState = {
  summary: WorkspaceSummary | null;
  recents: RecentWorkspace[];
  processes: ProcessInfo[];
  logs: LogEntry[];
  analysis: AnalysisReport | null;
  analysisLoading: boolean;
  analysisError: string;
  affected: AffectedReport | null;
  affectedLoading: boolean;
  affectedError: string;
  dependencies: DependencyReport | null;
  dependenciesLoading: boolean;
  dependenciesError: string;
  launchingTargetKeys: string[];
  activeLogProcessId: string;
  selectedPath: string;
  selectedRoots: string[];
  loading: boolean;
  error: string;
  loadRecents: () => Promise<void>;
  chooseWorkspace: () => Promise<void>;
  inspect: (root: string) => Promise<void>;
  inspectGroup: (groupID: string) => Promise<void>;
  runTarget: (target: Target, commandOverride?: string) => Promise<void>;
  stopProcess: (processId: string) => Promise<void>;
  restartProcess: (processId: string) => Promise<void>;
  setActiveLogProcess: (processId: string) => void;
  findRunningProcessForTarget: (target: Target) => ProcessInfo | undefined;
  isTargetBusy: (target: Target) => boolean;
  latestProcessForTarget: (target: Target) => ProcessInfo | undefined;
  targetStatus: (target: Target) => "idle" | "starting" | "running" | "failed" | "success" | "stopped";
  bindEvents: () => void;
  analyzeWorkspace: () => Promise<void>;
  analyzeAffected: () => Promise<void>;
  analyzeDependencies: () => Promise<void>;
};

function upsertProcess(items: ProcessInfo[], next: ProcessInfo): ProcessInfo[] {
  const idx = items.findIndex((item) => item.id === next.id);
  if (idx === -1) {
    return [next, ...items];
  }
  const clone = [...items];
  clone[idx] = next;
  return clone;
}

function isLabWorkspacePath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return normalized.includes("/labs/");
}

function processBelongsToRoots(workDir: string, roots: string[]): boolean {
  return roots.some((root) => workDir.startsWith(root));
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  summary: null,
  recents: [],
  processes: [],
  logs: [],
  analysis: null,
  analysisLoading: false,
  analysisError: "",
  affected: null,
  affectedLoading: false,
  affectedError: "",
  dependencies: null,
  dependenciesLoading: false,
  dependenciesError: "",
  launchingTargetKeys: [],
  activeLogProcessId: "",
  selectedPath: "",
  selectedRoots: [],
  loading: false,
  error: "",
  loadRecents: async () => {
    const recents = await wailsService.listRecentWorkspaces();
    set({ recents });
    if (!get().selectedPath && recents.length > 0) {
      const preferred = recents.find((item) => !isLabWorkspacePath(item.path)) ?? recents[0];
      await get().inspect(preferred.path);
    }
  },
  chooseWorkspace: async () => {
    const path = await wailsService.openWorkspaceDialog();
    if (!path) {
      return;
    }
    set({ selectedPath: path });
    await get().inspect(path);
  },
  inspect: async (root: string) => {
    try {
      set({
        loading: true,
        error: "",
        analysis: null,
        analysisError: "",
        affected: null,
        affectedError: "",
        dependencies: null,
        dependenciesError: "",
      });
      const [summary, processes] = await Promise.all([
        wailsService.inspectWorkspace(root),
        wailsService.listProcesses(),
      ]);
      const workspaceProcesses = processes.filter((proc) => proc.workDir.startsWith(root));
      set((state) => ({
        summary,
        processes: workspaceProcesses,
        selectedPath: root,
        selectedRoots: summary.rootPaths && summary.rootPaths.length > 0 ? summary.rootPaths : [root],
        activeLogProcessId: state.activeLogProcessId || (workspaceProcesses[0]?.id ?? ""),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to inspect workspace";
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },
  inspectGroup: async (groupID: string) => {
    try {
      set({
        loading: true,
        error: "",
        analysis: null,
        analysisError: "",
        affected: null,
        affectedError: "",
        dependencies: null,
        dependenciesError: "",
      });
      const [summary, processes] = await Promise.all([
        wailsService.inspectGroup(groupID),
        wailsService.listProcesses(),
      ]);
      const roots = summary.rootPaths && summary.rootPaths.length > 0 ? summary.rootPaths : [];
      const workspaceProcesses = processes.filter((proc) => processBelongsToRoots(proc.workDir, roots));
      set((state) => ({
        summary,
        processes: workspaceProcesses,
        selectedPath: summary.rootPath,
        selectedRoots: roots,
        activeLogProcessId: state.activeLogProcessId || (workspaceProcesses[0]?.id ?? ""),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to inspect group";
      set({ error: message });
    } finally {
      set({ loading: false });
    }
  },
  runTarget: async (target: Target, commandOverride?: string) => {
    const command = commandOverride?.trim() || target.command;
    const key = `${target.workDir}::${command}`;
    const busy = !commandOverride && get().isTargetBusy(target);
    if (busy) {
      return;
    }

    set((state) => ({ launchingTargetKeys: [...state.launchingTargetKeys, key] }));
    try {
      const process = await wailsService.runCommand(target.workDir, command);
      set((state) => ({
        processes: upsertProcess(state.processes, process),
        activeLogProcessId: process.id,
      }));
    } finally {
      set((state) => ({
        launchingTargetKeys: state.launchingTargetKeys.filter((item) => item !== key),
      }));
    }
  },
  stopProcess: async (processId: string) => {
    await wailsService.stopCommand(processId);
  },
  restartProcess: async (processId: string) => {
    const process = await wailsService.restartCommand(processId);
    set((state) => ({
      processes: upsertProcess(state.processes, process),
      activeLogProcessId: process.id,
    }));
  },
  setActiveLogProcess: (processId: string) => set({ activeLogProcessId: processId }),
  findRunningProcessForTarget: (target: Target) => {
    return get().processes.find(
      (proc) =>
        proc.workDir === target.workDir &&
        proc.command === target.command &&
        (proc.status === "running" || proc.status === "starting"),
    );
  },
  isTargetBusy: (target: Target) => {
    const key = `${target.workDir}::${target.command}`;
    const launching = get().launchingTargetKeys.includes(key);
    if (launching) {
      return true;
    }
    return get().processes.some(
      (proc) =>
        proc.workDir === target.workDir &&
        proc.command === target.command &&
        (proc.status === "running" || proc.status === "starting"),
    );
  },
  latestProcessForTarget: (target: Target) => {
    for (const proc of get().processes) {
      if (proc.workDir === target.workDir && proc.command === target.command) {
        return proc;
      }
    }
    return undefined;
  },
  targetStatus: (target: Target) => {
    const latest = get().latestProcessForTarget(target);
    const key = `${target.workDir}::${target.command}`;
    const launching = get().launchingTargetKeys.includes(key);
    if (!latest) {
      return launching ? "starting" : "idle";
    }
    if (latest.status === "starting" || (launching && latest.status !== "running")) {
      return "starting";
    }
    if (latest.status === "running") {
      return "running";
    }
    if (latest.status === "failed") {
      return "failed";
    }
    if (latest.status === "stopped") {
      return "stopped";
    }
    if (latest.status === "exited") {
      return "success";
    }
    return "idle";
  },
  bindEvents: () => {
    wailsService.onLog((payload) => {
      const entry = payload as LogEntry;
      const roots = get().selectedRoots;
      if (!roots.length) {
        return;
      }
      const process = get().processes.find((proc) => proc.id === entry.processId);
      if (!process || !processBelongsToRoots(process.workDir, roots)) {
        return;
      }
      set((state) => ({
        logs: [...state.logs.slice(-799), entry],
        activeLogProcessId: state.activeLogProcessId || entry.processId,
      }));
    });

    wailsService.onProcessUpdated((payload) => {
      const proc = payload as ProcessInfo;
      const roots = get().selectedRoots;
      if (!roots.length || !processBelongsToRoots(proc.workDir, roots)) {
        return;
      }
      set((state) => ({
        processes: upsertProcess(state.processes, proc),
      }));
    });
  },
  analyzeWorkspace: async () => {
    const root = get().selectedPath;
    if (!root) {
      return;
    }
    try {
      set({ analysisLoading: true, analysisError: "" });
      const report = await wailsService.analyzeWorkspace(root);
      set({ analysis: report });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze workspace";
      set({ analysisError: message });
    } finally {
      set({ analysisLoading: false });
    }
  },
  analyzeAffected: async () => {
    const root = get().selectedPath;
    if (!root) {
      return;
    }
    try {
      set({ affectedLoading: true, affectedError: "" });
      const report = await wailsService.analyzeAffected(root);
      set({ affected: report });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze affected projects";
      set({ affectedError: message });
    } finally {
      set({ affectedLoading: false });
    }
  },
  analyzeDependencies: async () => {
    const root = get().selectedPath || get().summary?.rootPath || "";
    if (!root) {
      return;
    }
    try {
      set({ dependenciesLoading: true, dependenciesError: "" });
      const report = await wailsService.analyzeDependencies(root);
      set({ dependencies: report });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to analyze workspace dependencies";
      set({ dependenciesError: message });
    } finally {
      set({ dependenciesLoading: false });
    }
  },
}));

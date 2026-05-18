import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import type { PortCheckReport, ProcessInfo, ProfileItem, ProfileRuntimeState, RunProfile, RuntimeSession, Target, WorkspaceGroup } from "./types/workspace";
import { getLocale, t } from "./i18n";
import { wailsService } from "./services/wails";

const ICON = {
  moon: "\u263E",
  sun: "\u2600",
  play: "\u25B6",
  stop: "\u25A0",
  restart: "\u21BB",
  logs: "\u2261",
  bullet: "\u2022",
  copy: "\u29C9",
  close: "\u00D7",
  plus: "+",
  custom: ">_",
};

type PendingPortDecision = {
  target: Target;
  report: PortCheckReport;
};

function SidebarToggleIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.6" />
      {collapsed ? (
        <path d="M12 12h6M16 9l3 3-3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M18 12h-6M14 9l-3 3 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function WorkspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
      <path
        d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2c.4 0 .78.16 1.06.44l1.3 1.3c.28.28.66.44 1.06.44H19.5A1.5 1.5 0 0 1 21 8.68V17.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 11.2v5.6M9.2 14h5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GroupIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
      <rect x="4" y="4" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16.5 14.2v5.6M13.7 17h5.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function workspaceLabel(path: string): string {
  const clean = path.replace(/[\\/]+$/, "");
  const parts = clean.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function processProjectLabel(
  workDir: string,
  projects: { name: string; targets: { workDir: string }[] }[] | undefined,
): string {
  if (!projects) return workspaceLabel(workDir);
  for (const project of projects) {
    for (const target of project.targets) {
      if (target.workDir === workDir) return project.name;
    }
  }
  return workspaceLabel(workDir);
}

function statusLabel(status: "idle" | "starting" | "running" | "failed" | "success" | "stopped", locale: "en" | "pt-BR"): string {
  switch (status) {
    case "idle":
      return t("idle", locale);
    case "starting":
      return t("starting", locale);
    case "running":
      return t("running", locale);
    case "failed":
      return t("failed", locale);
    case "stopped":
      return t("stopped", locale);
    default:
      return t("healthy", locale);
  }
}

function rowClassFromStatus(status: "idle" | "starting" | "running" | "failed" | "success" | "stopped"): string {
  switch (status) {
    case "starting":
    case "running":
      return "row-running";
    case "success":
      return "row-success";
    case "failed":
      return "row-failed";
    default:
      return "";
  }
}

function formatUptime(startedAt?: string): string {
  if (!startedAt) return "-";
  const ms = Date.now() - new Date(startedAt).getTime();
  if (ms <= 0) return "0s";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function processHealth(process: ProcessInfo): "running" | "warning" | "failed" | "stopped" | "idle" {
  if ((process.status === "running" || process.status === "starting") && process.healthStatus !== "failed") {
    const base = process.lastOutputAt || process.startedAt;
    if (base && Date.now() - new Date(base).getTime() > 5 * 60 * 1000) {
      return "warning";
    }
  }
  if (process.healthStatus) return process.healthStatus;
  if (process.status === "failed") return "failed";
  if (process.status === "running" || process.status === "starting") return "running";
  if (process.status === "stopped" || process.status === "exited") return "stopped";
  return "idle";
}

function processHealthDetails(process: ProcessInfo): string {
  const health = processHealth(process);
  if (health === "failed") {
    return process.exitCode !== undefined ? `Exit code ${process.exitCode}` : "Process failed";
  }
  if (health === "warning") {
    return `No output since ${process.lastOutputAt ? new Date(process.lastOutputAt).toLocaleTimeString() : "a while"}`;
  }
  if (health === "running") {
    return `Uptime ${formatUptime(process.startedAt)}`;
  }
  if (health === "stopped") {
    return process.exitCode !== undefined ? `Exited with code ${process.exitCode}` : "Stopped";
  }
  return "Idle";
}

function severityRank(severity: string): number {
  switch (severity.toLowerCase()) {
    case "critical":
      return 5;
    case "high":
      return 4;
    case "moderate":
    case "medium":
      return 3;
    case "warning":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function prettifyDetails(details: string): string {
  const marker = "output:";
  const markerIndex = details.indexOf(marker);
  if (markerIndex === -1) return details;

  const afterMarker = details.slice(markerIndex + marker.length).trim();
  const errorSplit = afterMarker.split(" | error:");
  const maybeJSON = errorSplit[0].trim();

  const jsonStart = maybeJSON.indexOf("{");
  if (jsonStart === -1) return details;

  const before = details.slice(0, markerIndex).trimEnd();
  const jsonText = maybeJSON.slice(jsonStart);
  try {
    const parsed = JSON.parse(jsonText);
    let out = `${before}\noutput:\n${JSON.stringify(parsed, null, 2)}`;
    if (errorSplit.length > 1) {
      out += `\nerror:${errorSplit.slice(1).join(" | error:").trim()}`;
    }
    return out;
  } catch {
    return details;
  }
}

function logTone(message: string, stream: string): "success" | "error" | "warn" | "info" | "muted" {
  const text = message.trimStart().toLowerCase();
  if (stream === "stderr") return "error";
  if (text.startsWith("✓") || text.includes("ready in") || text.includes("compiled successfully")) return "success";
  if (text.startsWith("✖") || text.startsWith("x ") || text.includes("failed") || text.includes("error")) return "error";
  if (text.startsWith("⚠") || text.startsWith("warn") || text.includes("deprecated")) return "warn";
  if (text.startsWith("•") || text.startsWith("-") || text.startsWith(">")) return "muted";
  return "info";
}

export default function App() {
  const locale = getLocale();
  const {
    summary,
    recents,
    processes,
    logs,
    analysis,
    affected,
    affectedLoading,
    affectedError,
    activeLogProcessId,
    selectedPath,
    selectedRoots,
    loading,
    error,
    loadRecents,
    chooseWorkspace,
    inspect,
    inspectGroup,
    runTarget,
    stopProcess,
    restartProcess,
    setActiveLogProcess,
    findRunningProcessForTarget,
    isTargetBusy,
    targetStatus,
    analyzeWorkspace,
    analyzeAffected,
    bindEvents,
  } = useWorkspaceStore();
  const [query, setQuery] = useState("");
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [view, setView] = useState<"projects" | "processes" | "logs" | "analyze">("projects");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [hackerMode, setHackerMode] = useState(false);
  const [copiedKey, setCopiedKey] = useState("");
  const [closedLogTabs, setClosedLogTabs] = useState<string[]>([]);
  const [profiles, setProfiles] = useState<RunProfile[]>([]);
  const [profileStates, setProfileStates] = useState<Record<string, ProfileRuntimeState>>({});
  const [profileLoading, setProfileLoading] = useState(false);
  const [activeProfileTargetId, setActiveProfileTargetId] = useState("");
  const [expandedProfiles, setExpandedProfiles] = useState<string[]>([]);
  const [showRecents, setShowRecents] = useState(true);
  const [showGroups, setShowGroups] = useState(true);
  const [showRunProfiles, setShowRunProfiles] = useState(true);
  const [groups, setGroups] = useState<WorkspaceGroup[]>([]);
  const [lastSession, setLastSession] = useState<RuntimeSession | null>(null);
  const [ignoredRestoreRoots, setIgnoredRestoreRoots] = useState<string[]>([]);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [runningProfileIDs, setRunningProfileIDs] = useState<string[]>([]);
  const [stoppingProfileIDs, setStoppingProfileIDs] = useState<string[]>([]);
  const [activeProfileMenuID, setActiveProfileMenuID] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copyNotice, setCopyNotice] = useState("");
  const [pendingPortDecision, setPendingPortDecision] = useState<PendingPortDecision | null>(null);
  const [portActionLoading, setPortActionLoading] = useState(false);

  const loadProfiles = async () => {
    try {
      setProfileLoading(true);
      const items = await wailsService.listProfiles(selectedPath || "");
      setProfiles(items);
      const runtimeStates = await wailsService.listProfileRuntimeStates();
      const indexed: Record<string, ProfileRuntimeState> = {};
      for (const state of runtimeStates) indexed[state.profileID] = state;
      setProfileStates(indexed);
    } finally {
      setProfileLoading(false);
    }
  };

  const refreshProfileStates = async () => {
    const runtimeStates = await wailsService.listProfileRuntimeStates();
    const indexed: Record<string, ProfileRuntimeState> = {};
    for (const state of runtimeStates) indexed[state.profileID] = state;
    setProfileStates(indexed);
  };

  const loadGroups = async () => {
    const items = await wailsService.listGroups();
    setGroups(items);
  };

  useEffect(() => {
    bindEvents();
    void loadRecents();
    void loadGroups();
  }, [loadRecents, bindEvents]);

  useEffect(() => {
    void loadProfiles();
  }, [selectedPath]);

  useEffect(() => {
    void refreshProfileStates();
  }, [processes, selectedPath]);

  useEffect(() => {
    const saved = window.localStorage.getItem("monodock-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
    const savedSidebar = window.localStorage.getItem("monodock-sidebar-collapsed");
    setSidebarCollapsed(savedSidebar === "1");
  }, []);

  useEffect(() => {
    window.localStorage.setItem("monodock-theme", theme);
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem("monodock-sidebar-collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setSidebarCollapsed((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const root = selectedPath.trim();
    if (!root || ignoredRestoreRoots.includes(root)) {
      setLastSession(null);
      return;
    }
    void (async () => {
      try {
        const session = await wailsService.getLastRuntimeSession(root);
        if (session?.items?.length > 0) {
          setLastSession(session);
          window.setTimeout(() => {
            setLastSession((current) => {
              if (!current) return null;
              if (current.workspaceRoot !== session.workspaceRoot) return current;
              return null;
            });
          }, 8000);
          return;
        }
        setLastSession(null);
      } catch {
        setLastSession(null);
      }
    })();
  }, [selectedPath, ignoredRestoreRoots]);

  const rows = useMemo(() => {
    const projectRows: { projectName: string; projectPath: string; target: Target }[] = [];
    for (const project of summary?.projects ?? []) {
      for (const target of project.targets) {
        projectRows.push({ projectName: project.name, projectPath: project.path, target });
      }
    }
    return projectRows;
  }, [summary]);

  const filteredRows = rows.filter((row) => {
    const running = Boolean(findRunningProcessForTarget(row.target));
    if (onlyRunning && !running) return false;
    const q = query.trim().toLowerCase();
    if (q === "") return true;
    const joined = `${row.projectName} ${row.projectPath} ${row.target.name} ${row.target.command}`.toLowerCase();
    return joined.includes(q);
  });

  const visibleLogs = logs.filter((entry) => entry.processId === activeLogProcessId);
  const orderedFindings = useMemo(() => {
    const items = [...(analysis?.findings ?? [])];
    items.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
    return items;
  }, [analysis]);
  const tabProcesses = useMemo(() => {
    const seen = new Set<string>();
    const out = [];
    for (const process of processes) {
      const key = `${process.workDir}::${process.command}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(process);
    }
    return out;
  }, [processes]);
  const visibleProfiles = useMemo(() => profiles, [profiles]);
  const visibleTabProcesses = useMemo(
    () => tabProcesses.filter((process) => !closedLogTabs.includes(process.id)),
    [tabProcesses, closedLogTabs],
  );

  useEffect(() => {
    if (activeLogProcessId && visibleTabProcesses.some((p) => p.id === activeLogProcessId)) {
      return;
    }
    setActiveLogProcess(visibleTabProcesses[0]?.id ?? "");
  }, [activeLogProcessId, visibleTabProcesses, setActiveLogProcess]);

  const copyText = async (key: string, value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setCopyNotice("Copied to clipboard");
      window.setTimeout(() => setCopyNotice(""), 1200);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? "" : current)), 1500);
    } catch {
      setCopiedKey("");
    }
  };

  const copyAllVisibleLogs = async () => {
    const text = visibleLogs.map((entry) => `[${entry.stream}] ${entry.message}`).join("\n");
    await copyText("all-logs", text);
  };

  const openLogsForProcess = (processId: string) => {
    setClosedLogTabs((state) => state.filter((id) => id !== processId));
    setActiveLogProcess(processId);
    setView("logs");
  };

  const runTargetWithPortGuard = async (target: Target) => {
    try {
      const report = await wailsService.checkPortConflicts(target.workDir, target.command);
      if (report.conflicts.length > 0) {
        setPendingPortDecision({ target, report });
        return;
      }
    } catch {
      setRestoreMessage("Port check unavailable. Starting command...");
      window.setTimeout(() => setRestoreMessage(""), 2000);
    }
    await runTarget(target);
  };

  const stopConflictsAndRun = async () => {
    if (!pendingPortDecision) return;
    setPortActionLoading(true);
    try {
      for (const conflict of pendingPortDecision.report.conflicts) {
        await wailsService.stopPortProcess(
          pendingPortDecision.target.workDir,
          conflict.pid,
          conflict.managedProcessID || "",
        );
      }
      await runTarget(pendingPortDecision.target);
      setPendingPortDecision(null);
    } finally {
      setPortActionLoading(false);
    }
  };

  const runOnAnotherPort = async () => {
    if (!pendingPortDecision) return;
    const suggested = pendingPortDecision.report.suggestedPort || (pendingPortDecision.report.conflicts[0]?.port ?? 3000) + 1;
    const raw = window.prompt("Port", String(suggested));
    const port = Number(raw);
    if (!raw || !Number.isInteger(port) || port <= 0 || port > 65535) return;
    setPortActionLoading(true);
    try {
      const command = await wailsService.commandWithPort(
        pendingPortDecision.target.workDir,
        pendingPortDecision.target.command,
        port,
      );
      await runTarget(pendingPortDecision.target, command);
      setPendingPortDecision(null);
    } finally {
      setPortActionLoading(false);
    }
  };

  const runCustomCommand = async (workDir: string, suggested: string) => {
    const raw = window.prompt("Run custom command", suggested);
    const command = raw?.trim() ?? "";
    if (!command) return;
    await runTargetWithPortGuard({
      id: `custom:${workDir}:${command}`,
      name: command,
      command,
      workDir,
      kind: "custom",
    });
  };

  const runProfile = async (profileId: string) => {
    setRunningProfileIDs((state) => (state.includes(profileId) ? state : [...state, profileId]));
    try {
      const started = await wailsService.runProfile(profileId);
      const profile = visibleProfiles.find((item) => item.id === profileId);
      if (profile?.openLogsOnRun) {
        for (const proc of started) {
          openLogsForProcess(proc.id);
        }
      }
      const failed = Math.max(profile?.items.length ?? 0, started.length) - started.length;
      if (failed > 0) {
        setRestoreMessage(`${started.length} started, ${failed} failed`);
      } else {
        setRestoreMessage(`Starting ${profile?.name ?? "profile"}... ${started.length} processes started`);
      }
      await loadProfiles();
      if (selectedPath) await inspect(selectedPath);
    } finally {
      setRunningProfileIDs((state) => state.filter((id) => id !== profileId));
      window.setTimeout(() => setRestoreMessage(""), 2500);
    }
  };

  const stopProfile = async (profileId: string) => {
    setStoppingProfileIDs((state) => (state.includes(profileId) ? state : [...state, profileId]));
    try {
      await wailsService.stopProfile(profileId);
      await loadProfiles();
      if (selectedPath) await inspect(selectedPath);
    } finally {
      setStoppingProfileIDs((state) => state.filter((id) => id !== profileId));
    }
  };

  const deleteProfile = async (profileId: string) => {
    if (!window.confirm(t("confirmDeleteProfile", locale))) return;
    await wailsService.deleteProfile(profileId);
    await loadProfiles();
  };

  const profileStateLabel = (state: ProfileRuntimeState | undefined): string => {
    if (!state) return "Idle";
    switch (state.status) {
      case "running":
        return "Running";
      case "partial":
        return "Partial";
      case "failed":
        return "Failed";
      case "stopped":
        return "Stopped";
      default:
        return "Idle";
    }
  };

  const profileStateSummary = (state: ProfileRuntimeState | undefined): string => {
    if (!state || state.status === "idle") return "Never executed";
    const processByID = new Map(processes.map((proc) => [proc.id, proc]));
    const warningCount = state.processIDs.filter((id) => processByID.get(id)?.healthStatus === "warning").length;
    if (warningCount > 0) return `Warning · ${warningCount} silent process${warningCount > 1 ? "es" : ""}`;
    if (state.status === "running") return `Running · ${state.runningCount} processes`;
    if (state.status === "failed") return `Failed · ${state.failedCount || 1} process`;
    const parts: string[] = [];
    if (state.runningCount > 0) parts.push(`${state.runningCount} running`);
    if (state.failedCount > 0) parts.push(`${state.failedCount} failed`);
    if (state.stoppedCount > 0) parts.push(`${state.stoppedCount} stopped`);
    return parts.join(" • ");
  };

  const profileItemStatus = (state: ProfileRuntimeState | undefined, item: ProfileItem) => {
    if (!state) return "idle";
    const processByID = new Map(processes.map((proc) => [proc.id, proc]));
    const matchedIDs = state.processIDs.filter((id) => {
      const proc = processByID.get(id);
      return proc && proc.workDir === item.workDir && proc.command === item.command;
    });
    if (matchedIDs.length === 0) return "idle";
    const matched = matchedIDs.map((id) => processByID.get(id)).filter(Boolean);
    if (matched.some((p) => p?.healthStatus === "warning")) return "partial";
    if (matched.some((p) => p?.status === "running" || p?.status === "starting")) return "running";
    if (matched.some((p) => p?.status === "failed")) return "failed";
    if (matched.some((p) => p?.status === "stopped")) return "stopped";
    if (matched.some((p) => p?.status === "exited")) return "success";
    return "stopped";
  };

  const profileItemUptime = (state: ProfileRuntimeState | undefined, item: ProfileItem): string => {
    if (!state) return "-";
    const processByID = new Map(processes.map((proc) => [proc.id, proc]));
    const matched = state.processIDs
      .map((id) => processByID.get(id))
      .filter((proc) => proc && proc.workDir === item.workDir && proc.command === item.command) as ProcessInfo[];
    if (matched.length === 0) return "-";
    const running = matched.find((proc) => proc.status === "running" || proc.status === "starting");
    const latest = running ?? matched[0];
    return formatUptime(latest.startedAt);
  };

  const makeId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `id-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  };

  const buildProfileItem = (projectName: string, target: Target): ProfileItem => ({
    id: makeId(),
    project: projectName,
    target: target.name,
    workDir: target.workDir,
    command: target.command,
  });

  const hasDuplicateItem = (profile: RunProfile, item: ProfileItem) =>
    profile.items.some(
      (existing) =>
        existing.project === item.project &&
        existing.target === item.target &&
        existing.command === item.command,
    );

  const createProfileFromTarget = async (projectName: string, target: Target) => {
    const rawName = window.prompt(t("profileNamePrompt", locale), `${projectName} ${target.name}`.trim());
    const name = rawName?.trim() ?? "";
    if (!name) return;

    const now = new Date().toISOString();
    const profile: RunProfile = {
      id: makeId(),
      workspaceRoot: selectedPath || "",
      name,
      description: "",
      color: "blue",
      icon: "layers",
      autoStart: false,
      openLogsOnRun: true,
      createdAt: now,
      updatedAt: now,
      items: [buildProfileItem(projectName, target)],
    };
    await wailsService.saveProfile(profile);
    await loadProfiles();
    setActiveProfileTargetId("");
  };

  const addTargetToExistingProfile = async (profile: RunProfile, projectName: string, target: Target) => {
    const item = buildProfileItem(projectName, target);
    if (hasDuplicateItem(profile, item)) {
      window.alert(t("itemAlreadyInProfile", locale));
      return;
    }

    const updated: RunProfile = {
      ...profile,
      workspaceRoot: profile.workspaceRoot || selectedPath || "",
      updatedAt: new Date().toISOString(),
      items: [...profile.items, item],
    };
    await wailsService.saveProfile(updated);
    await loadProfiles();
    setActiveProfileTargetId("");
  };

  const updateProfile = async (profile: RunProfile) => {
    const normalized: RunProfile = {
      ...profile,
      workspaceRoot: profile.workspaceRoot || selectedPath || "",
    };
    await wailsService.saveProfile(normalized);
    await loadProfiles();
  };

  const renameProfile = async (profile: RunProfile) => {
    const value = window.prompt("Rename profile", profile.name);
    const name = value?.trim() ?? "";
    if (!name) return;
    await updateProfile({ ...profile, name, updatedAt: new Date().toISOString() });
  };

  const editProfileDescription = async (profile: RunProfile) => {
    const description = window.prompt("Description", profile.description || "") ?? "";
    await updateProfile({ ...profile, description: description.trim(), updatedAt: new Date().toISOString() });
  };

  const toggleProfileOpenLogs = async (profile: RunProfile) => {
    await updateProfile({ ...profile, openLogsOnRun: !profile.openLogsOnRun, updatedAt: new Date().toISOString() });
  };

  const copyProfile = async (profile: RunProfile) => {
    const now = new Date().toISOString();
    const copied: RunProfile = {
      ...profile,
      id: makeId(),
      name: `${profile.name} Copy`,
      createdAt: now,
      updatedAt: now,
      items: profile.items.map((item) => ({ ...item, id: makeId() })),
    };
    await wailsService.saveProfile(copied);
    await loadProfiles();
  };

  const restoreSession = async () => {
    const root = selectedPath.trim();
    if (!root) return;
    try {
      setRestoreLoading(true);
      const restored = await wailsService.restoreRuntimeSession(root);
      setLastSession(null);
      setRestoreMessage(`${restored.length} ${t("restoredProcesses", locale)}`);
      await inspect(root);
      await loadProfiles();
    } finally {
      setRestoreLoading(false);
      window.setTimeout(() => setRestoreMessage(""), 2000);
    }
  };

  const createGroup = async () => {
    const name = window.prompt("Group name");
    if (!name || !name.trim()) return;
    const roots = await wailsService.openGroupRootsDialog();
    if (!roots || roots.length === 0) return;
    const now = new Date().toISOString();
    await wailsService.saveGroup({
      id: "",
      name: name.trim(),
      roots,
      createdAt: now,
      updatedAt: now,
    });
    await loadGroups();
  };

  return (
    <>
      {/* Splash disabled for now; we will redesign and enable it later.
      {showSplash && (
        <div className={`splash-screen ${hackerMode ? "theme-hacker" : theme === "light" ? "theme-light" : "theme-dark"}`}>
          <div className="splash-content">
            <img className="splash-bg-image" src="/assets/splash-reference.png" alt="MonoDock splash" />
            <div className="splash-overlay">
              <div className="splash-loading-title">{locale === "pt-BR" ? "Carregando seu workspace..." : "Loading your workspace..."}</div>
              <div className="splash-progress-track">
                <div className="splash-progress-fill" style={{ width: `${splashProgress}%` }} />
              </div>
              <div className="splash-loading-subtitle">
                <span className="splash-spinner" aria-hidden />
                <span>{locale === "pt-BR" ? "Inicializando serviços..." : "Initializing services..."}</span>
              </div>
            </div>
          </div>
        </div>
      )} */}
      <main className={`docker-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""} ${hackerMode ? "theme-hacker" : theme === "light" ? "theme-light" : "theme-dark"}`}>
      <header className="top-header">
        <div className="header-left">
          <div>MonoDock Desktop</div>
          {hackerMode && <div className="header-hacker-flag">{t("hackerMode", locale)}</div>}
        </div>
        <div className="header-search-wrap">
          <input
            className="header-search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim().toLowerCase() === "slauers") {
                setHackerMode(true);
                setTheme("dark");
                setQuery("");
                e.preventDefault();
              }
            }}
            placeholder={t("searchPlaceholder", locale)}
          />
        </div>
        <div className="header-right">
          <button
            className="header-refresh-btn"
            onClick={() => selectedPath && void inspect(selectedPath)}
            title="Refresh workspace"
            aria-label="Refresh workspace"
          >
            {ICON.restart}
          </button>
          <label className="theme-switch" title="Toggle theme">
            <input
              type="checkbox"
              checked={theme === "dark"}
              onChange={(e) => {
                setTheme(e.target.checked ? "dark" : "light");
                setHackerMode(false);
              }}
              aria-label={t("toggleDarkMode", locale)}
            />
            <span className="theme-track">
              <span className="theme-thumb">
                <span className="theme-glyph">{theme === "dark" ? ICON.moon : ICON.sun}</span>
              </span>
            </span>
          </label>
          <button className="window-close-btn" title="Close" aria-label="Close" onClick={() => void wailsService.closeApp()}>
            {ICON.close}
          </button>
        </div>
      </header>

      <div className="body-layout">
        <aside className={`side-nav ${sidebarCollapsed ? "collapsed" : ""}`}>
          <div className="side-quick-actions">
            <button
              className="quick-icon-btn"
              onClick={() => setSidebarCollapsed((v) => !v)}
              title="Hide sidebar"
              aria-label="Hide sidebar"
            >
              <SidebarToggleIcon collapsed={false} />
            </button>
            <button className="quick-icon-btn" onClick={() => void chooseWorkspace()} title={t("openWorkspace", locale)} aria-label={t("openWorkspace", locale)}>
              <WorkspaceIcon />
            </button>
            <button className="quick-icon-btn" onClick={() => void createGroup()} title="Create Group" aria-label="Create Group">
              <GroupIcon />
            </button>
          </div>
          <div className="nav-group">
            <button className={view === "projects" ? "nav-main active" : "nav-main"} onClick={() => setView("projects")}>
              {t("projects", locale)}
            </button>
            <button className={view === "processes" ? "nav-main active" : "nav-main"} onClick={() => setView("processes")}>
              {t("processes", locale)}
            </button>
            <button className={view === "logs" ? "nav-main active" : "nav-main"} onClick={() => setView("logs")}>
              {t("logs", locale)}
            </button>
            <button className={view === "analyze" ? "nav-main active" : "nav-main"} onClick={() => setView("analyze")}>
              {t("analyze", locale)}
            </button>
          </div>
          <div className="sidebar-section">
            <button className="section-header" onClick={() => setShowRecents((v) => !v)}>
              <span>{showRecents ? "▾" : "▸"}</span>
              <span>{t("recents", locale).toUpperCase()}</span>
            </button>
            {showRecents && (
              <div className="recent-block">
                <ul className="recent-list">
                  {recents.map((item) => (
                    <li key={item.path}>
                      <button className="recent-item" onClick={() => void inspect(item.path)} title={item.path}>
                        {workspaceLabel(item.path)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="sidebar-section">
            <button className="section-header" onClick={() => setShowGroups((v) => !v)}>
              <span>{showGroups ? "▾" : "▸"}</span>
              <span>GROUPS</span>
            </button>
            {showGroups && (
              <div className="profiles-block">
                <div className="profiles-scroll">
                  {groups.length === 0 && (
                    <div className="profiles-empty">
                      <div>No workspace groups yet</div>
                      <div className="profiles-hint">Create one to combine multiple repositories</div>
                    </div>
                  )}
                  {groups.length > 0 && (
                    <ul className="profiles-list">
                      {groups.map((group) => (
                        <li key={group.id} className="profile-item">
                          <button className="profile-name-btn" onClick={() => void inspectGroup(group.id)} title={group.roots.join("\n")}>
                            <span className="profile-head-dot" />
                            {group.name}
                          </button>
                          <div className="runtime-meta">{group.roots.length} roots</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="sidebar-section">
            <button className="section-header" onClick={() => setShowRunProfiles((v) => !v)}>
              <span>{showRunProfiles ? "▾" : "▸"}</span>
              <span>{t("runProfiles", locale).toUpperCase()}</span>
            </button>
            {showRunProfiles && (
              <div className="profiles-block run-profiles-block">
            <div className="profiles-scroll">
              {profileLoading && <div className="profiles-empty">Loading...</div>}
              {!profileLoading && visibleProfiles.length === 0 && (
                <div className="profiles-empty">
                  <div>{t("noRunProfilesYet", locale)}</div>
                  <div className="profiles-hint">{t("runProfilesHint", locale)}</div>
                </div>
              )}
              {!profileLoading && visibleProfiles.length > 0 && (
                <ul className="profiles-list run-profiles-list">
                  {visibleProfiles.map((profile) => (
                    <li key={profile.id} className="profile-item">
                    <div className="profile-meta">
                      <button
                        className="profile-name-btn"
                        onClick={() =>
                          setExpandedProfiles((state) =>
                            state.includes(profile.id) ? state.filter((id) => id !== profile.id) : [...state, profile.id],
                          )
                        }
                        title={profile.name}
                      >
                        <span className="profile-expand">{expandedProfiles.includes(profile.id) ? "▼" : "▶"}</span>
                        <span className="profile-head-dot" />
                        {profile.name}
                      </button>
                      {profile.description && <div className="profile-description">{profile.description}</div>}
                    </div>
                    <div className="profile-actions">
                      <button className="profile-run-btn" onClick={() => void runProfile(profile.id)} title={t("run", locale)} disabled={runningProfileIDs.includes(profile.id)}>
                        {runningProfileIDs.includes(profile.id) ? <span className="mini-spinner" aria-hidden /> : ICON.play} {t("run", locale)}
                      </button>
                      <button
                        className="profile-stop-btn"
                        onClick={() => void stopProfile(profile.id)}
                        title="Stop all"
                        disabled={!profileStates[profile.id] || profileStates[profile.id].runningCount === 0 || stoppingProfileIDs.includes(profile.id)}
                      >
                        {stoppingProfileIDs.includes(profile.id) ? <span className="mini-spinner" aria-hidden /> : ICON.stop} Stop all
                      </button>
                      <button className="profile-delete-btn" onClick={() => void deleteProfile(profile.id)} title={t("delete", locale)} aria-label={t("delete", locale)}>
                        {ICON.close}
                      </button>
                      <button
                        className="profile-menu-btn"
                        title="Profile actions"
                        onClick={() => setActiveProfileMenuID((state) => (state === profile.id ? "" : profile.id))}
                      >
                        ⋯
                      </button>
                    </div>
                    {activeProfileMenuID === profile.id && (
                      <div className="profile-menu-popover">
                        <button className="profile-popover-btn secondary" onClick={() => void runProfile(profile.id)}>Run</button>
                        <button className="profile-popover-btn secondary" onClick={() => void stopProfile(profile.id)}>Stop</button>
                        <button className="profile-popover-btn secondary" onClick={() => void renameProfile(profile)}>Rename</button>
                        <button className="profile-popover-btn secondary" onClick={() => void editProfileDescription(profile)}>Edit description</button>
                        <button className="profile-popover-btn secondary" onClick={() => void toggleProfileOpenLogs(profile)}>
                          {profile.openLogsOnRun ? "Disable auto-open logs" : "Enable auto-open logs"}
                        </button>
                        <button className="profile-popover-btn secondary" onClick={() => void copyProfile(profile)}>Copy profile</button>
                        <button className="profile-popover-btn secondary danger" onClick={() => void deleteProfile(profile.id)}>Delete</button>
                      </div>
                    )}
                    <div className="profile-runtime">
                      <span className={`runtime-dot ${(profileStates[profile.id]?.status ?? "idle")}`} />
                      <span className={`runtime-status ${(profileStates[profile.id]?.status ?? "idle")}`}>{profileStateLabel(profileStates[profile.id])}</span>
                      <span className="runtime-meta">{profileStateSummary(profileStates[profile.id])}</span>
                    </div>
                    {expandedProfiles.includes(profile.id) && (
                      <div className="profile-tree">
                        {profile.items.map((item) => {
                          const itemStatus = profileItemStatus(profileStates[profile.id], item);
                          return (
                            <div key={item.id} className="profile-tree-row">
                              <span className={`runtime-dot ${itemStatus}`} />
                              <span className={`runtime-status ${itemStatus}`}>{item.target}</span>
                              <span className="runtime-meta mono">{item.command} - {profileItemUptime(profileStates[profile.id], item)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
              </div>
            )}
          </div>
        </aside>
        {sidebarCollapsed && (
          <button
            className="sidebar-restore-fab"
            onClick={() => setSidebarCollapsed(false)}
            title="Show sidebar"
            aria-label="Show sidebar"
          >
            <SidebarToggleIcon collapsed />
          </button>
        )}

        <section className="content-area">
          <div className="content-head">
            <div>
              <h1>{t("targets", locale)}</h1>
              <p>{selectedPath || t("noWorkspaceSelected", locale)}</p>
            </div>
            <div className="head-stats">
              <div>
                <strong>{summary?.packageManager || "n/a"}</strong>
                <span>{t("packageManager", locale)}</span>
              </div>
              <div>
                <strong>{summary?.monorepoTool || "none"}</strong>
                <span>{t("monorepoTool", locale)}</span>
              </div>
              <div>
                <strong>{summary?.gitBranch || "n/a"}</strong>
                <span>{t("branch", locale)}</span>
              </div>
            </div>
          </div>
          {lastSession && lastSession.items.length > 0 && (
            <div className="restore-banner">
              <div className="restore-banner-text">
                <div className="restore-title">{t("previousSessionFound", locale)}</div>
                <div className="restore-subtitle">{lastSession.items.length} {t("previousSessionDetails", locale)}</div>
              </div>
              <div className="restore-banner-actions">
                <button className="restore-btn" disabled={restoreLoading} onClick={() => void restoreSession()}>
                  {restoreLoading ? <span className="mini-spinner" aria-hidden /> : t("restore", locale)}
                </button>
                <button
                  className="ignore-btn"
                  onClick={() => {
                    setIgnoredRestoreRoots((state) => [...state, selectedPath]);
                    setLastSession(null);
                  }}
                >
                  {t("ignore", locale)}
                </button>
              </div>
            </div>
          )}
          {restoreMessage && <div className="restore-feedback">{restoreMessage}</div>}

          {view === "projects" && (
            <div className="toolbar">
              <label>
                <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} />
                <span>{t("onlyRunning", locale)}</span>
              </label>
            </div>
          )}

          {view === "projects" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("status", locale)}</th>
                    <th>{t("project", locale)}</th>
                    <th>{t("target", locale)}</th>
                    <th>{t("command", locale)}</th>
                    <th>{t("actions", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => {
                    const running = findRunningProcessForTarget(row.target);
                    const busy = isTargetBusy(row.target);
                    const status = targetStatus(row.target);
                    return (
                      <tr key={row.target.id} className={rowClassFromStatus(status)}>
                        <td>
                          <span className={`status-dot ${status}`} title={statusLabel(status, locale)} />
                        </td>
                        <td>{row.projectName}</td>
                        <td>{row.target.name}</td>
                        <td className="mono">{row.target.command}</td>
                        <td>
                          <div className="action-group">
                            <button className="icon icon-play" title={t("play", locale)} onClick={() => void runTargetWithPortGuard(row.target)} disabled={busy}>
                              {ICON.play}
                            </button>
                            <button className="icon icon-stop" title={t("stop", locale)} onClick={() => running && void stopProcess(running.id)} disabled={!running}>
                              {ICON.stop}
                            </button>
                            <button className="icon icon-restart" title={t("restart", locale)} onClick={() => running && void restartProcess(running.id)} disabled={!running}>
                              {ICON.restart}
                            </button>
                            <button
                              className="icon icon-custom"
                              title="Run custom command"
                              onClick={() => void runCustomCommand(row.target.workDir, row.target.command)}
                            >
                              {ICON.custom}
                            </button>
                            {running && (
                              <button className="icon icon-logs" title={t("openLogs", locale)} onClick={() => openLogsForProcess(running.id)}>
                                {ICON.logs}
                              </button>
                            )}
                            <div className="profile-action-wrap">
                              <button
                                className="profile-link-btn"
                                title={t("addToProfile", locale)}
                                onClick={() => setActiveProfileTargetId((state) => (state === row.target.id ? "" : row.target.id))}
                              >
                                {ICON.plus} Profile
                              </button>
                              {activeProfileTargetId === row.target.id && (
                                <div className="profile-popover">
                                  <button
                                    className="profile-popover-btn"
                                    onClick={() => void createProfileFromTarget(row.projectName, row.target)}
                                  >
                                    {t("createNewProfile", locale)}
                                  </button>
                                  <div className="profile-popover-label">{t("addToExistingProfile", locale)}</div>
                                  <div className="profile-popover-list">
                                    {visibleProfiles.length === 0 && <div className="profile-popover-empty">{t("noRunProfilesYet", locale)}</div>}
                                    {visibleProfiles.map((profile) => (
                                      <button
                                        key={profile.id}
                                        className="profile-popover-btn secondary"
                                        onClick={() => void addTargetToExistingProfile(profile, row.projectName, row.target)}
                                      >
                                        {profile.name}
                                      </button>
                                    ))}
                                  </div>
                                  <button className="profile-popover-close" onClick={() => setActiveProfileTargetId("")}>
                                    {t("cancel", locale)}
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {view === "processes" && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t("project", locale)}</th>
                    <th>{t("command", locale)}</th>
                    <th>{t("status", locale)}</th>
                    <th>Health</th>
                    <th>Uptime</th>
                    <th>Restarts</th>
                    <th>Exit</th>
                    <th>{t("action", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((process) => (
                    <tr key={process.id}>
                      <td>{processProjectLabel(process.workDir, summary?.projects)}</td>
                      <td className="mono">{process.command}</td>
                      <td title={processHealthDetails(process)}>
                        <span className={`runtime-dot ${processHealth(process)}`} style={{ marginRight: 6 }} />
                        {process.healthStatus || process.status} · {formatUptime(process.startedAt)}{process.restartCount > 0 ? ` · r${process.restartCount}` : ""}
                      </td>
                      <td>
                        <span className={`runtime-dot ${processHealth(process)}`} style={{ marginRight: 6 }} />
                        {processHealth(process)}
                      </td>
                      <td>{formatUptime(process.startedAt)}</td>
                      <td>{process.restartCount}</td>
                      <td>{process.exitCode ?? "-"}</td>
                      <td>
                        <div className="action-group">
                          <button
                            className="icon icon-play"
                            title={t("runAgain", locale)}
                            aria-label={t("runAgain", locale)}
                            onClick={() =>
                              void runTargetWithPortGuard({
                                id: process.id,
                                name: process.command,
                                command: process.command,
                                workDir: process.workDir,
                                kind: "script",
                              })
                            }
                            disabled={process.status === "running" || process.status === "starting"}
                          >
                            {ICON.play}
                          </button>
                          <button
                            className="icon icon-stop"
                            title={t("stop", locale)}
                            aria-label={t("stop", locale)}
                            onClick={() => void stopProcess(process.id)}
                            disabled={process.status !== "running" && process.status !== "starting"}
                          >
                            {ICON.stop}
                          </button>
                          <button className="icon icon-restart" title={t("restart", locale)} aria-label={t("restart", locale)} onClick={() => void restartProcess(process.id)}>
                            {ICON.restart}
                          </button>
                          <button className="icon icon-logs" onClick={() => openLogsForProcess(process.id)} title={t("openLogs", locale)} aria-label={t("openLogs", locale)}>
                            {ICON.logs}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === "analyze" && (
            <div className="logs-card logs-card-large">
              <div className="logs-head">{t("packageAnalyze", locale)}</div>
              <div className="action-group" style={{ marginBottom: 8 }}>
                <button className="action-text-btn icon-restart" title={t("runAnalysis", locale)} onClick={() => void analyzeWorkspace()}>
                  <span aria-hidden>{ICON.restart}</span>
                  <span>{t("analyze", locale)}</span>
                </button>
                <span>{t("analyzeHelp", locale)}</span>
              </div>
              <pre>
                {!analysis && <div>{t("noAnalysisYet", locale)}</div>}
                {orderedFindings.length === 0 && analysis && <div>{t("noFindings", locale)}</div>}
                {orderedFindings.map((finding) => (
                  <div key={finding.id} className={`analysis-item severity-${finding.severity.toLowerCase()}`}>
                    <div className="analysis-title">
                      <span className={`severity-pill severity-${finding.severity.toLowerCase()}`}>{finding.severity.toUpperCase()}</span> {finding.title}
                    </div>
                    {finding.packageName && <div>Package: {finding.packageName}</div>}
                    {finding.projectPath && <div>Project: {finding.projectPath}</div>}
                    {finding.details && (
                      <div>
                        Details:
                        <pre className="analysis-details">{prettifyDetails(finding.details)}</pre>
                      </div>
                    )}
                    {finding.fixVersion && <div>Fix: {finding.fixVersion}</div>}
                    {finding.reference && (
                      <div>
                        Reference:{" "}
                        <a href={finding.reference} target="_blank" rel="noreferrer">
                          {finding.reference}
                        </a>
                      </div>
                    )}
                    {finding.suggestion && <div>Suggestion: {finding.suggestion}</div>}
                  </div>
                ))}
              </pre>
              <div className="logs-head" style={{ marginTop: 10 }}>{t("affectedProjects", locale)}</div>
              <div className="action-group" style={{ marginBottom: 8 }}>
                <button className="action-text-btn icon-logs" title={t("analyzeAffected", locale)} onClick={() => void analyzeAffected()}>
                  <span>{t("analyzeAffected", locale)}</span>
                </button>
              </div>
              <pre>
                {affectedLoading && <div>{t("analyzingChangedFiles", locale)}</div>}
                {!affectedLoading && affectedError && <div className="error">{affectedError}</div>}
                {!affectedLoading && !affectedError && affected?.notGitRepository && <div>{affected.message || t("notGitRepo", locale)}</div>}
                {!affectedLoading && !affectedError && affected && !affected.notGitRepository && affected.changedFiles.length === 0 && <div>{t("affectedEmpty", locale)}</div>}
                {!affectedLoading && !affectedError && affected && !affected.notGitRepository && affected.changedFiles.length > 0 && (
                  <div>
                    <div>{affected.changedFiles.length} {t("changedFiles", locale)}</div>
                    {affected.changedFiles.map((file, idx) => (
                      <div key={`${file.path}-${idx}`} className="mono">[{file.status}] {file.path}</div>
                    ))}
                    <div style={{ marginTop: 8 }}>{affected.projects.length} {t("affectedProjects", locale).toLowerCase()}</div>
                    {affected.projects.map((project) => {
                      const workspaceProject = summary?.projects.find((p) => p.name === project.name);
                      return (
                        <div key={project.name} style={{ marginTop: 6 }}>
                          <div><strong>{project.name}</strong></div>
                          <div className="action-group" style={{ margin: "4px 0" }}>
                            {(workspaceProject?.targets ?? []).slice(0, 4).map((target) => (
                              <button key={target.id} className="action-text-btn" onClick={() => void runTargetWithPortGuard(target)}>
                                {target.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </pre>
            </div>
          )}

          {view !== "analyze" && (
            <div className={view === "logs" ? "logs-card logs-card-large" : "logs-card"}>
              <div className="logs-head logs-head-row">
                <span>{t("logs", locale)}</span>
                {copyNotice && <span className="copy-notice">{copyNotice}</span>}
                <button
                  className={`copy-btn copy-header-btn ${copiedKey === "all-logs" ? "is-copied" : ""}`}
                  onClick={() => void copyAllVisibleLogs()}
                  title={t("copyAllLogs", locale)}
                  aria-label={t("copyAllLogs", locale)}
                >
                  {ICON.copy}
                </button>
              </div>
              <div className="log-tabs">
                {visibleTabProcesses.map((process) => (
                  <button
                    key={process.id}
                    className={process.id === activeLogProcessId ? "tab active" : "tab"}
                    onClick={() => setActiveLogProcess(process.id)}
                    title={`${processHealthDetails(process)} | ${processProjectLabel(process.workDir, summary?.projects)} ${ICON.bullet} ${process.command}`}
                  >
                    <span className="tab-label">
                      {processHealth(process) === "running" ? "●" : processHealth(process) === "warning" ? "⚠" : processHealth(process) === "failed" ? "✕" : "○"} {processProjectLabel(process.workDir, summary?.projects)} {ICON.bullet} {process.command}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      className="tab-close"
                      title="Close log tab"
                      aria-label="Close log tab"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setClosedLogTabs((state) => (state.includes(process.id) ? state : [...state, process.id]));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          setClosedLogTabs((state) => (state.includes(process.id) ? state : [...state, process.id]));
                        }
                      }}
                    >
                      ×
                    </span>
                  </button>
                ))}
              </div>
              <pre>
                {activeLogProcessId === "" && <div className="empty-state">{t("selectLogTab", locale)}</div>}
                {visibleLogs.map((entry, index) => (
                  <div className={`log-line tone-${logTone(entry.message, entry.stream)}`} key={`${entry.timestamp}-${index}`}>
                    <span className="log-line-text">
                      {entry.stream === "stdout" ? entry.message : `[${entry.stream}] ${entry.message}`}
                    </span>
                    <button
                      className={`copy-btn copy-line-btn ${copiedKey === `${entry.timestamp}-${index}` ? "is-copied" : ""}`}
                      onClick={() => void copyText(`${entry.timestamp}-${index}`, `[${entry.stream}] ${entry.message}`)}
                      title={t("copyLine", locale)}
                      aria-label={t("copyLine", locale)}
                    >
                      {ICON.copy}
                    </button>
                  </div>
                ))}
              </pre>
            </div>
          )}
        </section>
      </div>

      <footer className="app-footer">
        <span className="footer-left-placeholder" />
        <div className={`footer-status footer-center ${loading || error ? "visible" : ""}`}>
          {loading && (
            <>
              <span className="footer-spinner" aria-hidden />
              <span>{t("inspectingWorkspace", locale)}</span>
            </>
          )}
          {error && <span className="error">{error}</span>}
        </div>
        <button
          className="footer-right footer-easter-egg"
          onClick={() => {
            setHackerMode(true);
            setTheme("dark");
          }}
          title="Enable hacker mode"
          aria-label="Enable hacker mode"
        >
          {t("by", locale)}
        </button>
      </footer>
      {pendingPortDecision && (
        <div className="modal-backdrop" role="presentation">
          <div className="port-dialog" role="dialog" aria-modal="true" aria-label="Port conflict">
            <div className="port-dialog-title">Port already in use</div>
            <div className="port-dialog-subtitle">
              {pendingPortDecision.report.conflicts.map((conflict) => (
                <div key={`${conflict.port}-${conflict.pid}`}>
                  Port <strong>{conflict.port}</strong> is used by{" "}
                  <span className="mono">{conflict.command || `PID ${conflict.pid}`}</span>
                  {conflict.managed ? " (MonoDock)" : ""}
                </div>
              ))}
            </div>
            <div className="port-dialog-command mono">{pendingPortDecision.target.command}</div>
            <div className="port-dialog-actions">
              <button className="restore-btn" disabled={portActionLoading} onClick={() => void stopConflictsAndRun()}>
                Stop existing
              </button>
              <button className="action-text-btn" disabled={portActionLoading} onClick={() => void runOnAnotherPort()}>
                Run on another port
              </button>
              <button className="ignore-btn" disabled={portActionLoading} onClick={() => setPendingPortDecision(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      </main>
    </>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import type { ProfileItem, ProfileRuntimeState, RunProfile, RuntimeSession, Target } from "./types/workspace";
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
};

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

export default function App() {
  const locale = getLocale();
  const {
    summary,
    recents,
    processes,
    logs,
    analysis,
    activeLogProcessId,
    selectedPath,
    loading,
    error,
    loadRecents,
    chooseWorkspace,
    inspect,
    runTarget,
    stopProcess,
    restartProcess,
    setActiveLogProcess,
    findRunningProcessForTarget,
    isTargetBusy,
    targetStatus,
    analyzeWorkspace,
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
  const [lastSession, setLastSession] = useState<RuntimeSession | null>(null);
  const [ignoredRestoreRoots, setIgnoredRestoreRoots] = useState<string[]>([]);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState("");
  const [runningProfileIDs, setRunningProfileIDs] = useState<string[]>([]);
  const [stoppingProfileIDs, setStoppingProfileIDs] = useState<string[]>([]);

  const loadProfiles = async () => {
    try {
      setProfileLoading(true);
      const items = await wailsService.listProfiles();
      setProfiles(items);
      const runtimeStates = await wailsService.listProfileRuntimeStates();
      const indexed: Record<string, ProfileRuntimeState> = {};
      for (const state of runtimeStates) indexed[state.profileID] = state;
      setProfileStates(indexed);
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    bindEvents();
    void loadRecents();
    void loadProfiles();
  }, [loadRecents, bindEvents]);

  useEffect(() => {
    const saved = window.localStorage.getItem("monodock-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("monodock-theme", theme);
  }, [theme]);

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

  const runProfile = async (profileId: string) => {
    setRunningProfileIDs((state) => (state.includes(profileId) ? state : [...state, profileId]));
    try {
      await wailsService.runProfile(profileId);
      await loadProfiles();
      if (selectedPath) await inspect(selectedPath);
    } finally {
      setRunningProfileIDs((state) => state.filter((id) => id !== profileId));
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
    if (state.status === "running") return `${state.runningCount} processes`;
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
    if (matched.some((p) => p?.status === "running" || p?.status === "starting")) return "running";
    if (matched.some((p) => p?.status === "failed")) return "failed";
    if (matched.some((p) => p?.status === "stopped")) return "stopped";
    if (matched.some((p) => p?.status === "exited")) return "success";
    return "stopped";
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
      name,
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
      updatedAt: new Date().toISOString(),
      items: [...profile.items, item],
    };
    await wailsService.saveProfile(updated);
    await loadProfiles();
    setActiveProfileTargetId("");
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
      <main className={`docker-shell ${hackerMode ? "theme-hacker" : theme === "light" ? "theme-light" : "theme-dark"}`}>
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
        <aside className="side-nav">
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
          <button className="open-btn" onClick={() => void chooseWorkspace()}>
            {t("openWorkspace", locale)}
          </button>
          <div className="recent-block">
            <div className="recent-title">{t("recents", locale)}</div>
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
          <div className="profiles-block">
            <div className="recent-title">{t("runProfiles", locale).toUpperCase()}</div>
            <div className="profiles-scroll">
              {profileLoading && <div className="profiles-empty">Loading...</div>}
              {!profileLoading && profiles.length === 0 && (
                <div className="profiles-empty">
                  <div>{t("noRunProfilesYet", locale)}</div>
                  <div className="profiles-hint">{t("runProfilesHint", locale)}</div>
                </div>
              )}
              {!profileLoading && profiles.length > 0 && (
                <ul className="profiles-list">
                  {profiles.map((profile) => (
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
                    </div>
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
                              <span className="runtime-meta mono">{item.command}</span>
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
        </aside>

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
                            <button className="icon icon-play" title={t("play", locale)} onClick={() => void runTarget(row.target)} disabled={busy}>
                              {ICON.play}
                            </button>
                            <button className="icon icon-stop" title={t("stop", locale)} onClick={() => running && void stopProcess(running.id)} disabled={!running}>
                              {ICON.stop}
                            </button>
                            <button className="icon icon-restart" title={t("restart", locale)} onClick={() => running && void restartProcess(running.id)} disabled={!running}>
                              {ICON.restart}
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
                                    {profiles.length === 0 && <div className="profile-popover-empty">{t("noRunProfilesYet", locale)}</div>}
                                    {profiles.map((profile) => (
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
                    <th>{t("action", locale)}</th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((process) => (
                    <tr key={process.id}>
                      <td>{processProjectLabel(process.workDir, summary?.projects)}</td>
                      <td className="mono">{process.command}</td>
                      <td>{process.status}</td>
                      <td>
                        <div className="action-group">
                          <button
                            className="icon icon-play"
                            title={t("runAgain", locale)}
                            aria-label={t("runAgain", locale)}
                            onClick={() =>
                              void runTarget({
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
            </div>
          )}

          {view !== "analyze" && (
            <div className={view === "logs" ? "logs-card logs-card-large" : "logs-card"}>
              <div className="logs-head logs-head-row">
                <span>{t("logs", locale)}</span>
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
                    title={`${processProjectLabel(process.workDir, summary?.projects)} ${ICON.bullet} ${process.command}`}
                  >
                    <span className="tab-label">
                      {processProjectLabel(process.workDir, summary?.projects)} {ICON.bullet} {process.command}
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
                  <div className="log-line" key={`${entry.timestamp}-${index}`}>
                    <span className="log-line-text">
                      [{entry.stream}] {entry.message}
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
      </main>
    </>
  );
}

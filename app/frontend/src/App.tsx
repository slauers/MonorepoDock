import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "./stores/useWorkspaceStore";
import type { Target } from "./types/workspace";
import { getLocale, t } from "./i18n";

const ICON = {
  moon: "\u263E",
  sun: "\u2600",
  dot: "\u25CF",
  play: "\u25B6",
  stop: "\u25A0",
  restart: "\u21BB",
  logs: "\u2261",
  bullet: "\u2022",
  copy: "\u29C9",
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

  useEffect(() => {
    void loadRecents();
    bindEvents();
  }, [loadRecents, bindEvents]);

  useEffect(() => {
    const saved = window.localStorage.getItem("monodock-theme");
    if (saved === "light" || saved === "dark") setTheme(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("monodock-theme", theme);
  }, [theme]);

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

  return (
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

          {view === "projects" && (
            <div className="toolbar">
              <label>
                <input type="checkbox" checked={onlyRunning} onChange={(e) => setOnlyRunning(e.target.checked)} />
                <span>{t("onlyRunning", locale)}</span>
              </label>
            </div>
          )}

          {(loading || error) && (
            <div className="status-strip">
              {loading && <span>{t("inspectingWorkspace", locale)}</span>}
              {error && <span className="error">{error}</span>}
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
                          <span className={`status-dot ${status}`} title={statusLabel(status, locale)}>
                            {ICON.dot}
                          </span>
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
                              <button className="icon icon-logs" title={t("openLogs", locale)} onClick={() => setActiveLogProcess(running.id)}>
                                {ICON.logs}
                              </button>
                            )}
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
                          <button className="icon icon-logs" onClick={() => setActiveLogProcess(process.id)} title={t("openLogs", locale)} aria-label={t("openLogs", locale)}>
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
                {analysis?.findings.length === 0 && <div>{t("noFindings", locale)}</div>}
                {analysis?.findings.map((finding) => (
                  <div key={finding.id}>
                    [{finding.severity}] {finding.title}
                    {finding.packageName ? ` | package: ${finding.packageName}` : ""}
                    {finding.projectPath ? ` | project: ${finding.projectPath}` : ""}
                    {finding.details ? ` | ${finding.details}` : ""}
                    {finding.suggestion ? ` | suggestion: ${finding.suggestion}` : ""}
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
                {tabProcesses.map((process) => (
                  <button
                    key={process.id}
                    className={process.id === activeLogProcessId ? "tab active" : "tab"}
                    onClick={() => setActiveLogProcess(process.id)}
                    title={`${processProjectLabel(process.workDir, summary?.projects)} ${ICON.bullet} ${process.command}`}
                  >
                    {processProjectLabel(process.workDir, summary?.projects)} {ICON.bullet} {process.command}
                  </button>
                ))}
              </div>
              <pre>
                {activeLogProcessId === "" && <div>{t("selectLogTab", locale)}</div>}
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
        <span>{t("by", locale)}</span>
      </footer>
    </main>
  );
}

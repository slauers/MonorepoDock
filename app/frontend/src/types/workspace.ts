export type Project = {
  name: string;
  path: string;
  scripts: string[];
  targets: Target[];
};

export type Target = {
  id: string;
  name: string;
  command: string;
  workDir: string;
  kind: string;
};

export type WorkspaceSummary = {
  rootPath: string;
  rootPaths?: string[];
  packageManager: string;
  monorepoTool: string;
  gitBranch: string;
  projects: Project[];
};

export type WorkspaceGroup = {
  id: string;
  name: string;
  roots: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProcessInfo = {
  id: string;
  command: string;
  workDir: string;
  startedAt: string;
  stoppedAt?: string;
  exitCode?: number;
  restartCount: number;
  lastOutputAt?: string;
  healthStatus: "running" | "idle" | "stopped" | "failed" | "warning";
  status: string;
};

export type LogEntry = {
  processId: string;
  stream: string;
  message: string;
  timestamp: string;
};

export type RecentWorkspace = {
  path: string;
  lastOpened: string;
};

export type AnalysisFinding = {
  id: string;
  category: string;
  severity: string;
  title: string;
  details: string;
  projectPath: string;
  packageName: string;
  suggestion: string;
  reference: string;
  fixVersion: string;
};

export type AnalysisReport = {
  workspacePath: string;
  scannedAt: string;
  findings: AnalysisFinding[];
};

export type ChangedFile = {
  path: string;
  status: string;
};

export type AffectedProject = {
  name: string;
  root: string;
  changedFiles: ChangedFile[];
};

export type AffectedReport = {
  workspaceRoot: string;
  changedFiles: ChangedFile[];
  projects: AffectedProject[];
  generatedAt: string;
  notGitRepository: boolean;
  message: string;
};

export type ProfileItem = {
  id: string;
  project: string;
  target: string;
  workDir: string;
  command: string;
};

export type RunProfile = {
  id: string;
  workspaceRoot: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  autoStart: boolean;
  openLogsOnRun: boolean;
  createdAt: string;
  updatedAt: string;
  items: ProfileItem[];
};

export type ProfileRuntimeState = {
  profileID: string;
  status: "idle" | "running" | "partial" | "failed" | "stopped";
  runningCount: number;
  stoppedCount: number;
  failedCount: number;
  processIDs: string[];
};

export type RuntimeSessionItem = {
  processID: string;
  command: string;
  workDir: string;
  project: string;
  target: string;
  profileID?: string;
};

export type RuntimeSession = {
  workspaceRoot: string;
  updatedAt: string;
  items: RuntimeSessionItem[];
};

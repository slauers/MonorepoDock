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
  packageManager: string;
  monorepoTool: string;
  gitBranch: string;
  projects: Project[];
};

export type ProcessInfo = {
  id: string;
  command: string;
  workDir: string;
  startedAt: string;
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

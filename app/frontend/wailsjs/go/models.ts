export namespace affected {
	
	export class ChangedFile {
	    path: string;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new ChangedFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.status = source["status"];
	    }
	}
	export class AffectedProject {
	    name: string;
	    root: string;
	    changedFiles: ChangedFile[];
	
	    static createFrom(source: any = {}) {
	        return new AffectedProject(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.root = source["root"];
	        this.changedFiles = this.convertValues(source["changedFiles"], ChangedFile);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Report {
	    workspaceRoot: string;
	    changedFiles: ChangedFile[];
	    projects: AffectedProject[];
	    // Go type: time
	    generatedAt: any;
	    notGitRepository: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new Report(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspaceRoot = source["workspaceRoot"];
	        this.changedFiles = this.convertValues(source["changedFiles"], ChangedFile);
	        this.projects = this.convertValues(source["projects"], AffectedProject);
	        this.generatedAt = this.convertValues(source["generatedAt"], null);
	        this.notGitRepository = source["notGitRepository"];
	        this.message = source["message"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace analyzer {
	
	export class Finding {
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
	
	    static createFrom(source: any = {}) {
	        return new Finding(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.category = source["category"];
	        this.severity = source["severity"];
	        this.title = source["title"];
	        this.details = source["details"];
	        this.projectPath = source["projectPath"];
	        this.packageName = source["packageName"];
	        this.suggestion = source["suggestion"];
	        this.reference = source["reference"];
	        this.fixVersion = source["fixVersion"];
	    }
	}
	export class Report {
	    workspacePath: string;
	    scannedAt: string;
	    findings: Finding[];
	
	    static createFrom(source: any = {}) {
	        return new Report(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspacePath = source["workspacePath"];
	        this.scannedAt = source["scannedAt"];
	        this.findings = this.convertValues(source["findings"], Finding);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace config {
	
	export class RecentWorkspace {
	    path: string;
	    // Go type: time
	    lastOpened: any;
	
	    static createFrom(source: any = {}) {
	        return new RecentWorkspace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.lastOpened = this.convertValues(source["lastOpened"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace groups {
	
	export class Group {
	    id: string;
	    name: string;
	    roots: string[];
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Group(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.roots = source["roots"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace profiles {
	
	export class ProfileItem {
	    id: string;
	    project: string;
	    target: string;
	    workDir: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ProfileItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.project = source["project"];
	        this.target = source["target"];
	        this.workDir = source["workDir"];
	        this.command = source["command"];
	    }
	}
	export class Profile {
	    id: string;
	    workspaceRoot: string;
	    name: string;
	    description: string;
	    color: string;
	    icon: string;
	    autoStart: boolean;
	    openLogsOnRun: boolean;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    items: ProfileItem[];
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.workspaceRoot = source["workspaceRoot"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.color = source["color"];
	        this.icon = source["icon"];
	        this.autoStart = source["autoStart"];
	        this.openLogsOnRun = source["openLogsOnRun"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.items = this.convertValues(source["items"], ProfileItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ProfileRuntimeState {
	    profileID: string;
	    status: string;
	    runningCount: number;
	    stoppedCount: number;
	    failedCount: number;
	    processIDs: string[];
	
	    static createFrom(source: any = {}) {
	        return new ProfileRuntimeState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileID = source["profileID"];
	        this.status = source["status"];
	        this.runningCount = source["runningCount"];
	        this.stoppedCount = source["stoppedCount"];
	        this.failedCount = source["failedCount"];
	        this.processIDs = source["processIDs"];
	    }
	}

}

export namespace runner {
	
	export class Process {
	    id: string;
	    command: string;
	    workDir: string;
	    // Go type: time
	    startedAt: any;
	    // Go type: time
	    stoppedAt?: any;
	    exitCode?: number;
	    restartCount: number;
	    // Go type: time
	    lastOutputAt?: any;
	    healthStatus: string;
	    status: string;
	
	    static createFrom(source: any = {}) {
	        return new Process(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.command = source["command"];
	        this.workDir = source["workDir"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.stoppedAt = this.convertValues(source["stoppedAt"], null);
	        this.exitCode = source["exitCode"];
	        this.restartCount = source["restartCount"];
	        this.lastOutputAt = this.convertValues(source["lastOutputAt"], null);
	        this.healthStatus = source["healthStatus"];
	        this.status = source["status"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace session {
	
	export class RuntimeSessionItem {
	    processID: string;
	    command: string;
	    workDir: string;
	    project: string;
	    target: string;
	    profileID?: string;
	
	    static createFrom(source: any = {}) {
	        return new RuntimeSessionItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.processID = source["processID"];
	        this.command = source["command"];
	        this.workDir = source["workDir"];
	        this.project = source["project"];
	        this.target = source["target"];
	        this.profileID = source["profileID"];
	    }
	}
	export class RuntimeSession {
	    workspaceRoot: string;
	    // Go type: time
	    updatedAt: any;
	    items: RuntimeSessionItem[];
	
	    static createFrom(source: any = {}) {
	        return new RuntimeSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.workspaceRoot = source["workspaceRoot"];
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.items = this.convertValues(source["items"], RuntimeSessionItem);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace workspace {
	
	export class Target {
	    id: string;
	    name: string;
	    command: string;
	    workDir: string;
	    kind: string;
	
	    static createFrom(source: any = {}) {
	        return new Target(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.command = source["command"];
	        this.workDir = source["workDir"];
	        this.kind = source["kind"];
	    }
	}
	export class Project {
	    name: string;
	    path: string;
	    scripts: string[];
	    targets: Target[];
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.scripts = source["scripts"];
	        this.targets = this.convertValues(source["targets"], Target);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Summary {
	    rootPath: string;
	    rootPaths?: string[];
	    packageManager: string;
	    monorepoTool: string;
	    gitBranch: string;
	    projects: Project[];
	
	    static createFrom(source: any = {}) {
	        return new Summary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.rootPath = source["rootPath"];
	        this.rootPaths = source["rootPaths"];
	        this.packageManager = source["packageManager"];
	        this.monorepoTool = source["monorepoTool"];
	        this.gitBranch = source["gitBranch"];
	        this.projects = this.convertValues(source["projects"], Project);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}


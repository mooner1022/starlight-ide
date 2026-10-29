// The backend's API (see API.md at the repository root).

export interface Project {
    id: string;
    name: string;
    languageId: string;
    mainScript: string;
    enabled: boolean;
    compiled: boolean;
    activeJobs: number;
    allowedEvents?: string[];
}

export interface FileEntry {
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedMillis: number;
}

export interface FileContent {
    path: string;
    text: string;
    hash: string;
    modifiedMillis: number;
}

export interface Log {
    type: "VERBOSE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "CRITICAL";
    tag: string;
    message: string;
    millis: number;
}

export interface CompileResult {
    success: boolean;
    error?: string;
    errorPath?: string;
    errorLine?: number;
    errorColumn?: number;
    logs: Log[];
}

export interface EventInfo {
    id: string;
    name: string;
    functionName: string;
    comment?: string;
    args: { name: string; type: string; tsType: string }[];
}

export interface Language {
    id: string;
    name: string;
    fileExtension: string;
}

export interface SearchHit {
    path: string;
    line: number;
    text: string;
}

export interface DebugReply {
    replies: string[];
    error?: string;
    logs: Log[];
}

export interface Change {
    type: "fileWritten" | "fileDeleted" | "fileRenamed" | "compiled" | "enabledChanged" | "eventsChanged"
        | "projectCreated" | "projectDeleted" | "debugMessageSent";
    projectId: string;
    actor: string;
    path?: string;
    from?: string;
    to?: string;
    hash?: string;
    success?: boolean;
    enabled?: boolean;
}

export class ApiError extends Error {
    constructor(readonly status: number, message: string, readonly body: Record<string, unknown> = {}) {
        super(message);
    }
}

/** Called when a request finds the session gone, so the page can show the login again. */
let onUnauthorized: () => void = () => {};

export function setUnauthorizedHandler(handler: () => void): void {
    onUnauthorized = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, {
        method,
        credentials: "same-origin",
        headers: {
            ...(method === "GET" ? {} : { "X-Requested-With": "starlight-ide" }),
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined as T;
    const isJson = response.headers.get("Content-Type")?.includes("application/json");
    const data = isJson ? await response.json() : await response.text();
    if (!response.ok) {
        if (response.status === 401 && !path.endsWith("/login")) onUnauthorized();
        const message = typeof data === "object" && data?.error ? String(data.error) : `HTTP ${response.status}`;
        throw new ApiError(response.status, message, typeof data === "object" ? data : {});
    }
    return data as T;
}

const project = (id: string) => `/api/projects/${encodeURIComponent(id)}`;
const query = (params: Record<string, string | number | boolean>) =>
    "?" + Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

export const api = {
    session: () => request<{ authenticated: boolean; requireToken: boolean; version: string }>("GET", "/api/session"),
    login: (token: string) => request<void>("POST", "/api/login", { token }),
    logout: () => request<void>("POST", "/api/logout", {}),

    projects: () => request<Project[]>("GET", "/api/projects"),
    createProject: (name: string, language: string, events: string[]) =>
        request<Project>("POST", "/api/projects", { name, language, events }),
    languages: () => request<Language[]>("GET", "/api/languages"),
    events: () => request<EventInfo[]>("GET", "/api/events"),
    types: () => request<string>("GET", "/api/types"),

    project: (id: string) => request<Project>("GET", project(id)),
    files: (id: string, path = ".") => request<{ entries: FileEntry[]; truncated: boolean }>("GET", project(id) + "/files" + query({ path })),
    readFile: (id: string, path: string) => request<FileContent>("GET", project(id) + "/file" + query({ path })),
    writeFile: (id: string, path: string, text: string, expectedHash?: string) =>
        request<Omit<FileContent, "text">>("PUT", project(id) + "/file", { path, text, expectedHash }),
    deleteFile: (id: string, path: string) => request<void>("DELETE", project(id) + "/file" + query({ path })),
    renameFile: (id: string, from: string, to: string) => request<void>("POST", project(id) + "/rename", { from, to }),
    search: (id: string, q: string, regex: boolean, ignoreCase: boolean) =>
        request<SearchHit[]>("GET", project(id) + "/search" + query({ q, regex, ignoreCase })),
    compile: (id: string) => request<CompileResult>("POST", project(id) + "/compile", {}),
    setEnabled: (id: string, enabled: boolean) => request<Project>("PUT", project(id) + "/enabled", { enabled }),
    updateEvents: (id: string, allow: string[], disallow: string[]) =>
        request<{ allowed: string[] }>("PUT", project(id) + "/events", { allow, disallow }),
    logs: (id: string, since = 0) => request<Log[]>("GET", project(id) + "/logs" + query({ since })),
    debug: (id: string, text: string, options: { sender?: string; room?: string; isGroupChat?: boolean; waitSeconds?: number }) =>
        request<DebugReply>("POST", project(id) + "/debug", { text, ...options }),

    /** Changes and the project's logs as they happen; reconnects by itself. */
    stream(projectId: string | null, handlers: { change: (change: Change) => void; log: (log: Log) => void; status: (open: boolean) => void }): () => void {
        const source = new EventSource("/api/stream" + (projectId ? query({ project: projectId }) : ""));
        source.addEventListener("change", (e) => handlers.change(JSON.parse((e as MessageEvent).data)));
        source.addEventListener("log", (e) => handlers.log(JSON.parse((e as MessageEvent).data)));
        source.onopen = () => handlers.status(true);
        source.onerror = () => handlers.status(false);
        return () => source.close();
    },
};

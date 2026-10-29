// The IDE: projects and files on the left, the editor in the middle, panels below and on the right.

import { api, ApiError, type Change, type CompileResult, type EventInfo, type FileEntry, type Language, type Log, type Project } from "./api";
import { button, clear, h, icon, iconButton, logo, sparkle } from "./dom";
import { editorFont, isLibUri, monaco, setMonacoTheme, setStarlightTypes } from "./monaco";
import { BottomPanel, SidePanel } from "./panels";
import { applyPageTheme, loadSettings, openSettings, themeOf, type Settings } from "./settings";
import { palette } from "./theme";
import { confirmDialog, dialog, menu, pick, toast } from "./ui";

/** A file with a model in the editor. */
interface Doc {
    path: string;
    model: monaco.editor.ITextModel;
    /** Hash of the file as last read or saved; sent back so that saves don't overwrite other tools' edits. */
    savedHash: string;
    savedVersionId: number;
    /** Another tool changed the file while it had unsaved edits here. */
    changedElsewhere: boolean;
    /** StarLight's type declarations, opened by going to a definition; not a project file. */
    readOnly?: boolean;
    viewState?: monaco.editor.ICodeEditorViewState | null;
}

const ACTOR_NAMES: Record<string, string> = { mcp: "AI(MCP)", ide: "IDE", starlight: "StarLight" };

type ProjectSort = "name" | "state" | "recent" | "language";
const PROJECT_SORTS: { value: ProjectSort; label: string }[] = [
    { value: "name", label: "이름순" },
    { value: "state", label: "상태순" },
    { value: "recent", label: "최근 연 순" },
    { value: "language", label: "언어순" },
];
const PRELOADED = /\.(m?js|ts|json)$/;
/** Tab keys of StarLight's declaration files, which can't collide with project paths. */
const LIB_TAB_PREFIX = "::starlight/";
const MAX_PRELOADED_FILES = 60;
const MAX_PRELOADED_BYTES = 256 * 1024;
const MARKER_OWNER = "starlight";

export class Ide {
    readonly root = h("div", { class: "ide" });

    projects: Project[] = [];
    project: Project | null = null;
    events: EventInfo[] = [];
    private languages: Language[] = [];
    private files: FileEntry[] = [];
    private readonly docs = new Map<string, Doc>();
    private tabs: string[] = [];
    private active: string | null = null;
    private readonly expanded = new Set<string>();
    /** Files being saved: their change events are this page's own saves, answered before the save returns. */
    private readonly saving = new Set<string>();
    private closeStream: (() => void) | null = null;
    settings: Settings = loadSettings();

    readonly editor: monaco.editor.IStandaloneCodeEditor;
    private readonly bottom: BottomPanel;
    private readonly side: SidePanel;

    private readonly projectList = h("ul", { class: "project-list", role: "listbox", "aria-label": "프로젝트" });
    private readonly projectCount = h("span", { class: "count-chip" });
    private readonly projectSearch = h("input", { class: "project-search-input", type: "search", placeholder: "이름, 언어로 검색", spellcheck: false, "aria-label": "프로젝트 검색" });
    private readonly sortButton = h("button", { type: "button", class: "sort-button", title: "정렬 기준" });
    private projectSort: ProjectSort = (localStorage.getItem("ide.projectSort") as ProjectSort | null) ?? "name";
    /** When each project was last opened here, for sorting by it. */
    private readonly openedAt: Record<string, number> = readJson("ide.projectOpenedAt") ?? {};
    private readonly fileTree = h("ul", { class: "file-tree", role: "tree", "aria-label": "파일" });
    private readonly tabBar = h("div", { class: "tab-bar", role: "tablist" });
    private readonly editorHost = h("div", { class: "editor-host" });
    private readonly emptyState = h("div", { class: "empty-state" });
    private readonly banner = h("div", { class: "banner", hidden: true });
    private readonly header = h("div", { class: "header-project" });
    private readonly compileButton = h("button", { type: "button", class: "compile-button", title: "컴파일 (Ctrl+Shift+B)" });
    private readonly status = {
        connection: h("span", { class: "status-item connection" }),
        project: h("span", { class: "status-item" }),
        problems: h("button", { type: "button", class: "status-item status-button" }),
        cursor: h("span", { class: "status-item" }),
        language: h("span", { class: "status-item" }),
        saved: h("span", { class: "status-item" }),
    };

    constructor(private readonly onLogout: () => void) {

        this.bottom = new BottomPanel(this);
        this.side = new SidePanel(this);
        this.editor = monaco.editor.create(this.editorHost, {
            model: null,
            automaticLayout: true,
            ...editorFont,
            ...this.editorOptions(),
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            renderLineHighlight: "all",
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: "active", indentation: true },
            stickyScroll: { enabled: true },
            padding: { top: 12, bottom: 12 },
            scrollBeyondLastLine: false,
            tabSize: 4,
            fixedOverflowWidgets: true,
            // Words of the file would bury what the language service knows.
            wordBasedSuggestions: "off",
            // Ctrl+click goes to the declaration, and from the declaration itself to its references.
            gotoLocation: {
                multipleDefinitions: "peek",
                multipleReferences: "peek",
                alternativeDefinitionCommand: "editor.action.goToReferences",
            },
        });
        this.build();
        this.bindKeys();
        this.editor.onDidChangeCursorPosition((e) => {
            this.status.cursor.textContent = `줄 ${e.position.lineNumber}, 열 ${e.position.column}`;
        });
        monaco.editor.onDidChangeMarkers(() => {
            this.renderProblemCount();
            this.bottom.renderProblems();
        });
        window.addEventListener("beforeunload", (e) => {
            if (this.dirtyDocs().length > 0) e.preventDefault();
        });
        this.registerEventSnippets();
        this.registerOpener();
        this.applySettings();
        window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
            if (this.settings.themeMode === "system") this.applySettings();
        });
    }

    /**
     * Going to a definition or reference in another file (Ctrl+click, F12, the references peek) opens it in a tab;
     * Monaco can only move within the file it shows.
     */
    private registerOpener(): void {
        monaco.editor.registerEditorOpener({
            openCodeEditor: (_source, resource, selectionOrPosition) => {
                const position = !selectionOrPosition ? undefined
                    : "startLineNumber" in selectionOrPosition
                        ? { line: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
                        : { line: selectionOrPosition.lineNumber, column: selectionOrPosition.column };
                if (isLibUri(resource)) {
                    const model = monaco.editor.getModel(resource);
                    if (!model) return false;
                    this.openLib(model, position);
                    return true;
                }
                const path = this.pathOf(resource);
                if (!path) return false;
                void this.openFile(path, position);
                return true;
            },
        });
    }

    /** Opens one of StarLight's declaration files in a read-only tab. */
    private openLib(model: monaco.editor.ITextModel, position?: { line: number; column?: number }): void {
        const key = LIB_TAB_PREFIX + model.uri.path.slice(model.uri.path.lastIndexOf("/") + 1);
        if (!this.docs.has(key))
            this.docs.set(key, { path: key, model, savedHash: "", savedVersionId: model.getAlternativeVersionId(), changedElsewhere: false, readOnly: true });
        if (!this.tabs.includes(key)) this.tabs.push(key);
        this.activate(key);
        if (position) {
            const target = { lineNumber: position.line, column: position.column ?? 1 };
            this.editor.setPosition(target);
            this.editor.revealPositionInCenter(target);
        }
        this.editor.focus();
    }

    async start(): Promise<void> {
        const [types, events, languages] = await Promise.all([
            api.types().catch(() => ""),
            api.events().catch(() => [] as EventInfo[]),
            api.languages().catch(() => [] as Language[]),
        ]);
        if (types) setStarlightTypes(types);
        this.events = events;
        this.languages = languages;
        await this.refreshProjects();
        const last = localStorage.getItem("ide.project");
        const initial = this.projects.find((p) => p.id === last) ?? this.projects[0];
        if (initial) await this.selectProject(initial.id);
        else this.renderAll();
    }

    // ------------------------------------------------------------------ layout

    private build(): void {
        const sidebar = h("aside", { class: "sidebar card" },
            h("section", { class: "sidebar-section projects-section" },
                h("header", { class: "section-header" }, sparkle(11), h("span", { class: "section-title" }, "프로젝트", this.projectCount),
                    this.sortButton,
                    iconButton("plus", "새 프로젝트", () => void this.createProject()),
                    iconButton("refresh", "새로고침", () => void this.refreshProjects())),
                h("label", { class: "project-search" }, icon("search", 14), this.projectSearch),
                this.projectList),
            h("section", { class: "sidebar-section files-section" },
                h("header", { class: "section-header" }, sparkle(11), h("span", {}, "파일"),
                    iconButton("plus", "새 파일", () => void this.createFile()),
                    iconButton("refresh", "새로고침", () => void this.refreshFiles())),
                this.fileTree));

        const center = h("main", { class: "center" },
            h("section", { class: "card editor-card" },
                this.tabBar,
                this.banner,
                h("div", { class: "editor-area" }, this.editorHost, this.emptyState)),
            this.bottom.root);

        this.compileButton.addEventListener("click", () => void this.compile());
        this.setCompiling(false);
        const header = h("header", { class: "topbar" },
            h("div", { class: "brand" }, logo(22), h("span", { class: "brand-name" }, "STARLIGHT"), h("span", { class: "brand-sub" }, "IDE")),
            this.header,
            h("button", { type: "button", class: "finder", onClick: () => void this.quickOpen() },
                icon("search", 14), h("span", {}, "파일로 이동"), h("kbd", {}, "Ctrl P")),
            h("div", { class: "topbar-actions" },
                iconButton("panelLeft", "왼쪽 패널 접기/펴기 (Ctrl+B)", () => this.togglePanel("left"), { class: "toggle-left" }),
                iconButton("panelRight", "오른쪽 패널 접기/펴기 (Ctrl+Alt+B)", () => this.togglePanel("right"), { class: "toggle-right" }),
                h("span", { class: "divider" }),
                iconButton("save", "저장 (Ctrl+S)", () => void this.save()),
                this.compileButton,
                h("span", { class: "divider" }),
                iconButton("gear", "설정 (Ctrl+,)", () => this.openSettings(), { class: "settings-button" }),
                iconButton("logout", "로그아웃", () => this.onLogout())));

        const statusBar = h("footer", { class: "statusbar" },
            this.status.connection, this.status.project, this.status.problems,
            h("span", { class: "spacer" }),
            this.status.saved, this.status.cursor, this.status.language);
        this.status.problems.addEventListener("click", () => this.bottom.show("problems"));

        this.projectSearch.addEventListener("input", () => this.renderProjects());
        this.projectSearch.addEventListener("keydown", (e) => {
            if (e.key === "Escape") { this.projectSearch.value = ""; this.renderProjects(); }
            // Enter opens the first match.
            if (e.key === "Enter") (this.projectList.querySelector(".project-item") as HTMLElement | null)?.click();
        });
        this.sortButton.addEventListener("click", () => menu(this.sortButton, PROJECT_SORTS, this.projectSort, (value) => {
            this.projectSort = value as ProjectSort;
            localStorage.setItem("ide.projectSort", value);
            this.renderProjects();
        }));
        this.root.append(header, sidebar, splitter("sidebar"), center, splitter("side"), this.side.root, statusBar);
        restoreSizes(this.root);
        for (const side of ["left", "right"] as const)
            if (localStorage.getItem(`ide.collapsed.${side}`) === "true") this.togglePanel(side);
        this.setConnection(false);
        // Monaco measures characters once; web fonts arrive later.
        void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
    }

    /** Hides or shows the project/file panel (left) or the debug room/events panel (right). */
    private togglePanel(side: "left" | "right"): void {
        const collapsed = this.root.classList.toggle(side === "left" ? "no-left" : "no-right");
        this.root.querySelector(side === "left" ? ".toggle-left" : ".toggle-right")?.classList.toggle("off", collapsed);
        localStorage.setItem(`ide.collapsed.${side}`, String(collapsed));
    }

    private setCompiling(compiling: boolean): void {
        this.compileButton.disabled = compiling;
        this.compileButton.classList.toggle("busy", compiling);
        this.compileButton.replaceChildren(
            compiling ? h("span", { class: "spinner" }) : icon("play", 14),
            h("span", {}, compiling ? "컴파일 중" : "컴파일"));
    }

    private bindKeys(): void {
        const mod = monaco.KeyMod.CtrlCmd;
        this.editor.addCommand(mod | monaco.KeyCode.KeyS, () => void this.save());
        this.editor.addCommand(mod | monaco.KeyMod.Shift | monaco.KeyCode.KeyB, () => void this.compile());
        this.editor.addCommand(mod | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => this.bottom.show("search"));
        this.editor.addCommand(mod | monaco.KeyCode.KeyP, () => void this.quickOpen());
        this.editor.addCommand(mod | monaco.KeyCode.KeyB, () => this.togglePanel("left"));
        this.editor.addCommand(mod | monaco.KeyCode.KeyJ, () => this.bottom.toggleCollapsed());
        this.editor.addCommand(mod | monaco.KeyCode.Comma, () => this.openSettings());
        this.editor.addCommand(mod | monaco.KeyMod.Alt | monaco.KeyCode.KeyB, () => this.togglePanel("right"));
        // The same keys outside the editor.
        document.addEventListener("keydown", (e) => {
            if (!(e.ctrlKey || e.metaKey) || this.editor.hasTextFocus()) return;
            const key = e.key.toLowerCase();
            if (key === "s") { e.preventDefault(); void this.save(); }
            else if (key === "b" && e.shiftKey) { e.preventDefault(); void this.compile(); }
            else if (key === "f" && e.shiftKey) { e.preventDefault(); this.bottom.show("search"); }
            else if (key === "p" && !e.shiftKey) { e.preventDefault(); void this.quickOpen(); }
            else if (key === "b" && !e.shiftKey) { e.preventDefault(); this.togglePanel(e.altKey ? "right" : "left"); }
            else if (key === "j") { e.preventDefault(); this.bottom.toggleCollapsed(); }
            else if (key === ",") { e.preventDefault(); this.openSettings(); }
        });
    }

    openSettings(): void {
        openSettings(this.settings, (settings) => {
            this.settings = settings;
            this.applySettings();
        });
    }

    /** Applies [settings] to the page, the editor theme, the editor and every open file. */
    private applySettings(): void {
        const theme = themeOf(this.settings);
        applyPageTheme(this.settings);
        setMonacoTheme(theme, palette(theme, this.settings.accent));
        this.editor.updateOptions(this.editorOptions());
        for (const doc of this.docs.values())
            if (!doc.readOnly) doc.model.updateOptions({ tabSize: this.settings.tabSize, insertSpaces: true });
    }

    private editorOptions(): monaco.editor.IEditorOptions {
        const { fontSize, wordWrap, minimap, ligatures } = this.settings;
        return {
            fontSize,
            lineHeight: Math.round(fontSize * 1.56),
            fontLigatures: ligatures,
            wordWrap: wordWrap ? "on" : "off",
            minimap: { enabled: minimap, renderCharacters: false, scale: 1 },
        };
    }

    // ------------------------------------------------------------------ projects

    async refreshProjects(): Promise<void> {
        this.projects = await api.projects();
        if (this.project) {
            const fresh = this.projects.find((p) => p.id === this.project!.id);
            // The list doesn't carry allowed events; keep the ones read with the project.
            this.project = fresh ? { ...fresh, allowedEvents: this.project.allowedEvents } : null;
        }
        this.renderProjects();
        this.renderHeader();
    }

    async selectProject(id: string): Promise<void> {
        if (this.project?.id === id) return;
        if (this.dirtyDocs().length > 0 && !await confirmDialog("저장하지 않은 변경", "저장하지 않은 파일이 있어요. 저장하지 않고 다른 프로젝트로 옮길까요?", "옮기기")) return;
        this.closeAll();
        this.project = await api.project(id);
        localStorage.setItem("ide.project", id);
        this.openedAt[id] = Date.now();
        localStorage.setItem("ide.projectOpenedAt", JSON.stringify(this.openedAt));
        this.renderProjects();
        this.renderHeader();
        this.connect();
        await this.refreshFiles();
        await this.preload();
        this.bottom.onProjectChanged();
        this.side.onProjectChanged();
        await this.openFile(this.project.mainScript);
    }

    private async createProject(): Promise<void> {
        const values = await dialog("새 프로젝트", [
            { name: "name", label: "이름", placeholder: "영문, 숫자, 한글, -, _" },
            { name: "language", label: "언어", type: "select", value: this.languages.find((l) => /neon/i.test(l.id))?.id, options: this.languages.map((l) => ({ value: l.id, label: l.name })) },
            {
                name: "events", label: "받을 이벤트", type: "checkboxes",
                options: this.events.map((e) => ({ value: e.id, label: e.name, hint: e.functionName, checked: e.id === "starlight.message.create" })),
            },
        ], "만들기");
        if (!values) return;
        try {
            const project = await api.createProject(String(values.name), String(values.language), values.events as string[]);
            toast(`${project.name} 프로젝트를 만들었어요`, "success");
            await this.refreshProjects();
            await this.selectProject(project.id);
        } catch (e) {
            toast(errorMessage(e), "error");
        }
    }

    async setEnabled(enabled: boolean): Promise<void> {
        const project = this.project;
        if (!project) return;
        // A project that isn't compiled is always off in StarLight; say so instead of a switch that snaps back.
        if (!project.compiled) {
            this.renderHeader();
            if (enabled)
                toast(`${project.name}은(는) 컴파일되지 않아서 꺼져 있어요. 컴파일해야 켤 수 있어요.`, "warning", 8000, {
                    label: "컴파일하고 켜기",
                    run: () => void this.compileAndSetEnabled(true),
                });
            return;
        }
        try {
            this.project = { ...project, ...await api.setEnabled(project.id, enabled) };
            await this.refreshProjects();
            toast(`${project.name}을(를) ${enabled ? "켰어요" : "껐어요"}`, "success", 2500);
        } catch (e) {
            this.renderHeader();
            toast(e instanceof ApiError && /not compiled/.test(e.message)
                ? `${project.name}은(는) 컴파일되지 않아서 켤 수 없어요. 먼저 컴파일하세요.`
                : `${enabled ? "켜지" : "끄지"} 못했어요: ${errorMessage(e)}`, "error", 6000);
        }
    }

    private async compileAndSetEnabled(enabled: boolean): Promise<void> {
        const result = await this.compile();
        if (result?.success) await this.setEnabled(enabled);
        else if (result) toast("컴파일에 실패해서 켜지 않았어요. 출력 패널의 오류를 확인하세요.", "error", 6000);
    }

    private renderProjects(): void {
        clear(this.projectList);
        const query = this.projectSearch.value.trim().toLowerCase();
        const shown = this.projects
            .filter((p) => !query || p.name.toLowerCase().includes(query) || shortLanguage(p.languageId).toLowerCase().includes(query) || p.languageId.toLowerCase().includes(query))
            .sort(this.compareProjects());
        this.projectCount.textContent = query ? `${shown.length}/${this.projects.length}` : String(this.projects.length);
        this.sortButton.replaceChildren(h("span", {}, PROJECT_SORTS.find((s) => s.value === this.projectSort)!.label), icon("sort", 13));
        for (const project of shown) {
            const selected = project.id === this.project?.id;
            this.projectList.appendChild(h("li", {
                class: "project-item" + (selected ? " selected" : ""), role: "option", "aria-selected": selected, tabIndex: 0,
                title: `${project.name} · ${project.languageId}`,
                onClick: () => void this.selectProject(project.id),
                onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter") void this.selectProject(project.id); },
            },
                avatar(project.name),
                h("span", { class: "project-text" },
                    h("span", { class: "project-name" }, project.name),
                    h("span", { class: "project-meta" }, shortLanguage(project.languageId), " · ", stateLabel(project))),
                h("span", { class: "project-dot " + stateClass(project), title: stateLabel(project) })));
        }
        if (this.projects.length === 0) this.projectList.appendChild(h("li", { class: "muted-row" }, "프로젝트가 없어요"));
        else if (shown.length === 0) this.projectList.appendChild(h("li", { class: "muted-row" }, `'${this.projectSearch.value.trim()}'와(과) 맞는 프로젝트가 없어요`));
    }

    private compareProjects(): (a: Project, b: Project) => number {
        const byName = (a: Project, b: Project) => a.name.localeCompare(b.name, "ko");
        switch (this.projectSort) {
            case "state": {
                // Running first, then the ones that need compiling, then the ones that are off.
                const rank = (p: Project) => (!p.compiled ? 1 : p.enabled ? 0 : 2);
                return (a, b) => rank(a) - rank(b) || byName(a, b);
            }
            case "recent":
                return (a, b) => (this.openedAt[b.id] ?? 0) - (this.openedAt[a.id] ?? 0) || byName(a, b);
            case "language":
                return (a, b) => shortLanguage(a.languageId).localeCompare(shortLanguage(b.languageId)) || byName(a, b);
            default:
                return byName;
        }
    }

    private renderHeader(): void {
        clear(this.header);
        const project = this.project;
        this.status.project.textContent = project ? project.name : "";
        if (!project) return;
        const isOn = project.enabled && project.compiled;
        const toggle = h("input", { type: "checkbox", class: "switch", checked: isOn, "aria-label": "프로젝트 켜기" });
        toggle.addEventListener("change", () => void this.setEnabled(toggle.checked));
        // The switch beside it already says on/off, so the chip tells whether it is compiled.
        const stateChip = project.compiled
            ? h("span", { class: "chip state-" + stateClass(project) }, h("span", { class: "project-dot " + stateClass(project) }), project.enabled ? "실행 중" : "컴파일됨")
            : h("button", { type: "button", class: "chip chip-button state-pending", title: "눌러서 컴파일", onClick: () => void this.compile() },
                h("span", { class: "project-dot pending" }), "컴파일 필요");
        this.header.append(
            h("div", { class: "project-chip" },
                avatar(project.name),
                h("span", { class: "header-name" }, project.name),
                h("span", { class: "chip" }, shortLanguage(project.languageId)),
                stateChip),
            h("label", {
                class: "switch-label" + (project.compiled ? "" : " needs-compile"),
                title: project.compiled ? "프로젝트 켜기/끄기" : "컴파일되지 않은 프로젝트는 꺼져 있어요. 컴파일하면 켤 수 있어요.",
            }, toggle, h("span", {}, isOn ? "켜짐" : "꺼짐")));
    }

    // ------------------------------------------------------------------ files

    async refreshFiles(): Promise<void> {
        if (!this.project) return;
        const result = await api.files(this.project.id);
        this.files = result.entries.filter((f) => !isHidden(f.path));
        this.renderFiles();
    }

    /** Script files get models up front, so imports between them resolve and complete. */
    private async preload(): Promise<void> {
        const project = this.project;
        if (!project) return;
        const candidates = this.files
            .filter((f) => !f.isDirectory && PRELOADED.test(f.path) && f.size <= MAX_PRELOADED_BYTES && !this.docs.has(f.path))
            .slice(0, MAX_PRELOADED_FILES);
        await Promise.all(candidates.map(async (f) => {
            try {
                const file = await api.readFile(project.id, f.path);
                if (this.project?.id === project.id && !this.docs.has(f.path)) this.addDoc(file.path, file.text, file.hash);
            } catch { /* opened on demand instead */ }
        }));
    }

    private renderFiles(): void {
        clear(this.fileTree);
        const children = new Map<string, FileEntry[]>();
        for (const file of this.files) {
            const parent = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
            if (!children.has(parent)) children.set(parent, []);
            children.get(parent)!.push(file);
        }
        const render = (dir: string, depth: number) => {
            const entries = (children.get(dir) ?? []).sort((a, b) =>
                a.isDirectory === b.isDirectory ? a.path.localeCompare(b.path) : a.isDirectory ? -1 : 1);
            for (const entry of entries) {
                const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
                // An empty folder has nothing to show, so it neither expands nor gets an arrow.
                const isEmpty = entry.isDirectory && !children.has(entry.path);
                const isOpen = !isEmpty && this.expanded.has(entry.path);
                const doc = this.docs.get(entry.path);
                const row = h("li", {
                    class: "file-row" + (entry.path === this.active ? " active" : "") + (entry.isDirectory ? " directory" : ""),
                    style: `--depth: ${depth}`, role: "treeitem", tabIndex: 0,
                    "aria-expanded": entry.isDirectory && !isEmpty ? isOpen : undefined,
                    title: isEmpty ? `${entry.path} (빈 폴더)` : entry.path,
                    onClick: () => entry.isDirectory ? (isEmpty ? undefined : this.toggleDir(entry.path)) : void this.openFile(entry.path),
                    onKeydown: (e: KeyboardEvent) => { if (e.key === "Enter") (e.currentTarget as HTMLElement).click(); },
                },
                    entry.isDirectory && !isEmpty ? icon(isOpen ? "chevronDown" : "chevronRight", 14) : h("span", { class: "file-indent" }),
                    entry.isDirectory ? icon(isOpen ? "folderOpen" : "folder", 15) : fileIcon(entry.path),
                    h("span", { class: "file-name" + (entry.path === this.project?.mainScript ? " main-script" : "") }, name),
                    doc && this.isDirty(doc) ? h("span", { class: "dirty-dot", title: "저장 안 됨" }) : null,
                    entry.isDirectory ? null : h("span", { class: "row-actions" },
                        iconButton("edit", "이름 바꾸기", () => void this.renameFile(entry.path)),
                        iconButton("trash", "삭제", () => void this.deleteFile(entry.path))));
                row.querySelectorAll(".row-actions button").forEach((b) => b.addEventListener("click", (e) => e.stopPropagation()));
                this.fileTree.appendChild(row);
                if (entry.isDirectory && isOpen) render(entry.path, depth + 1);
            }
        };
        render("", 0);
        if (this.files.length === 0) this.fileTree.appendChild(h("li", { class: "muted-row" }, this.project ? "파일이 없어요" : "프로젝트를 고르세요"));
    }

    private toggleDir(path: string): void {
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        this.renderFiles();
    }

    async openFile(path: string, position?: { line: number; column?: number }): Promise<void> {
        const project = this.project;
        if (!project) return;
        let doc = this.docs.get(path);
        if (!doc) {
            try {
                const file = await api.readFile(project.id, path);
                if (this.project?.id !== project.id) return;
                doc = this.docs.get(path) ?? this.addDoc(file.path, file.text, file.hash);
            } catch (e) {
                toast(errorMessage(e), "error");
                return;
            }
        }
        if (!this.tabs.includes(path)) this.tabs.push(path);
        this.activate(path);
        // Reveal the file in the tree.
        const parts = path.split("/");
        for (let i = 1; i < parts.length; i++) this.expanded.add(parts.slice(0, i).join("/"));
        this.renderFiles();
        if (position) {
            const target = { lineNumber: position.line, column: position.column ?? 1 };
            this.editor.setPosition(target);
            this.editor.revealPositionInCenter(target);
        }
        this.editor.focus();
    }

    private addDoc(path: string, text: string, hash: string): Doc {
        const uri = monaco.Uri.from({ scheme: "file", path: `/${this.project!.id}/${path}` });
        monaco.editor.getModel(uri)?.dispose();
        const model = monaco.editor.createModel(text, languageOf(path), uri);
        model.updateOptions({ tabSize: this.settings.tabSize, insertSpaces: true });
        const doc: Doc = { path, model, savedHash: hash, savedVersionId: model.getAlternativeVersionId(), changedElsewhere: false };
        model.onDidChangeContent(() => {
            this.renderTabs();
            this.renderSaved();
        });
        this.docs.set(path, doc);
        return doc;
    }

    private activate(path: string | null): void {
        const current = this.active ? this.docs.get(this.active) : undefined;
        if (current) current.viewState = this.editor.saveViewState();
        this.active = path;
        const doc = path ? this.docs.get(path) : undefined;
        this.editor.setModel(doc?.model ?? null);
        this.editor.updateOptions({ readOnly: !!doc?.readOnly });
        if (doc?.viewState) this.editor.restoreViewState(doc.viewState);
        this.editorHost.hidden = !doc;
        this.emptyState.hidden = !!doc;
        this.renderEmptyState();
        this.renderTabs();
        this.renderBanner();
        this.renderSaved();
        this.status.language.textContent = doc ? (doc.readOnly ? "StarLight 타입 · 읽기 전용" : languageLabel(doc.path)) : "";
    }

    private closeTab(path: string): void {
        const doc = this.docs.get(path);
        if (doc && this.isDirty(doc)) {
            void confirmDialog("저장하지 않은 변경", `${path}의 변경 사항을 버릴까요?`, "버리기").then((ok) => {
                if (!ok) return;
                this.revert(doc);
                this.closeTab(path);
            });
            return;
        }
        const index = this.tabs.indexOf(path);
        this.tabs = this.tabs.filter((p) => p !== path);
        if (this.active === path) this.activate(this.tabs[Math.min(index, this.tabs.length - 1)] ?? null);
        else this.renderTabs();
    }

    private closeAll(): void {
        this.editor.setModel(null);
        for (const doc of this.docs.values()) if (!doc.readOnly) doc.model.dispose();
        this.docs.clear();
        this.tabs = [];
        this.active = null;
        this.files = [];
        this.expanded.clear();
    }

    private renderTabs(): void {
        clear(this.tabBar);
        for (const path of this.tabs) {
            const doc = this.docs.get(path);
            const name = doc?.readOnly ? path.slice(LIB_TAB_PREFIX.length) : path.slice(path.lastIndexOf("/") + 1);
            const active = path === this.active;
            const tab = h("div", {
                class: "tab" + (active ? " active" : "") + (doc?.changedElsewhere ? " conflict" : ""),
                role: "tab", "aria-selected": active, title: doc?.readOnly ? "StarLight 타입 선언 (읽기 전용)" : path, tabIndex: 0,
                onClick: () => this.activate(path),
                onAuxclick: (e: MouseEvent) => { if (e.button === 1) this.closeTab(path); },
            },
                fileIcon(path),
                h("span", { class: "tab-name" }, name),
                doc && this.isDirty(doc)
                    ? h("button", { type: "button", class: "tab-close dirty", title: "닫기", onClick: (e: Event) => { e.stopPropagation(); this.closeTab(path); } })
                    : h("button", { type: "button", class: "tab-close", title: "닫기", onClick: (e: Event) => { e.stopPropagation(); this.closeTab(path); } }, icon("close", 12)));
            this.tabBar.appendChild(tab);
        }
    }

    private renderEmptyState(): void {
        clear(this.emptyState);
        this.emptyState.append(
            h("div", { class: "empty-logo" }, logo(44)),
            h("h2", {}, this.project ? "열린 파일이 없어요" : "프로젝트를 고르세요"),
            h("p", {}, this.project ? "왼쪽에서 파일을 고르거나 바로 찾아 여세요." : "왼쪽 목록에서 프로젝트를 고르거나 새로 만드세요."),
            h("div", { class: "shortcut-grid" },
                ...[["Ctrl P", "파일로 이동"], ["Ctrl S", "저장"], ["Ctrl ⇧ B", "컴파일"], ["Ctrl ⇧ F", "프로젝트 검색"], ["F1", "명령 팔레트"], ["Ctrl B", "왼쪽 패널 접기"]]
                    .map(([key, label]) => h("div", { class: "shortcut" }, h("span", {}, label), h("kbd", {}, key)))));
    }

    private renderBanner(): void {
        const doc = this.active ? this.docs.get(this.active) : undefined;
        clear(this.banner);
        this.banner.hidden = !doc?.changedElsewhere;
        if (!doc?.changedElsewhere) return;
        this.banner.append(
            icon("warning"),
            h("span", {}, "다른 곳(앱 또는 AI)에서 이 파일을 바꿨어요. 저장하기 전에 비교해 보세요."),
            button("비교하기", () => void this.resolveConflict(doc), { class: "secondary small" }),
            button("다시 불러오기", () => void this.reload(doc), { class: "secondary small" }));
    }

    private renderSaved(): void {
        const doc = this.active ? this.docs.get(this.active) : undefined;
        this.status.saved.textContent = !doc ? "" : this.isDirty(doc) ? "● 수정됨" : "저장됨";
        this.status.saved.classList.toggle("dirty", !!doc && this.isDirty(doc));
    }

    private renderProblemCount(): void {
        const markers = this.projectMarkers();
        const errors = markers.filter((m) => m.severity === monaco.MarkerSeverity.Error).length;
        const warnings = markers.filter((m) => m.severity === monaco.MarkerSeverity.Warning).length;
        this.status.problems.replaceChildren(icon("error", 13), ` ${errors}  `, icon("warning", 13), ` ${warnings}`);
    }

    projectMarkers(): monaco.editor.IMarker[] {
        const prefix = this.project ? `/${this.project.id}/` : "\0";
        return monaco.editor.getModelMarkers({}).filter((m) => m.resource.path.startsWith(prefix));
    }

    pathOf(uri: monaco.Uri): string | null {
        const prefix = this.project ? `/${this.project.id}/` : null;
        return prefix && uri.path.startsWith(prefix) ? uri.path.slice(prefix.length) : null;
    }

    private renderAll(): void {
        this.renderProjects();
        this.renderHeader();
        this.renderFiles();
        this.activate(null);
    }

    // ------------------------------------------------------------------ editing files

    private isDirty(doc: Doc): boolean {
        return !doc.readOnly && doc.model.getAlternativeVersionId() !== doc.savedVersionId;
    }

    private dirtyDocs(): Doc[] {
        return [...this.docs.values()].filter((d) => this.isDirty(d));
    }

    /** Saves the active file; false if it couldn't be saved. */
    async save(path = this.active): Promise<boolean> {
        const doc = path ? this.docs.get(path) : undefined;
        if (!doc || !this.project || doc.readOnly) return true;
        if (!this.isDirty(doc) && !doc.changedElsewhere) return true;
        const text = doc.model.getValue();
        const versionId = doc.model.getAlternativeVersionId();
        this.saving.add(doc.path);
        try {
            const saved = await api.writeFile(this.project.id, doc.path, text, doc.savedHash);
            this.markSaved(doc, saved.hash, versionId);
            return true;
        } catch (e) {
            if (e instanceof ApiError && e.status === 409) {
                doc.changedElsewhere = true;
                this.renderTabs();
                this.renderBanner();
                return this.resolveConflict(doc);
            }
            toast(errorMessage(e), "error");
            return false;
        } finally {
            this.saving.delete(doc.path);
        }
    }

    private async saveAll(): Promise<boolean> {
        for (const doc of this.dirtyDocs())
            if (!await this.save(doc.path)) return false;
        return true;
    }

    private markSaved(doc: Doc, hash: string, versionId = doc.model.getAlternativeVersionId()): void {
        doc.savedHash = hash;
        doc.savedVersionId = versionId;
        doc.changedElsewhere = false;
        this.renderTabs();
        this.renderBanner();
        this.renderSaved();
        this.renderFiles();
    }

    /** Shows the file as it is now next to the edits here, and lets the user keep one. */
    private async resolveConflict(doc: Doc): Promise<boolean> {
        if (!this.project) return false;
        let theirs;
        try {
            theirs = await api.readFile(this.project.id, doc.path);
        } catch (e) {
            if (e instanceof ApiError && e.status === 400) theirs = { text: "", hash: "", path: doc.path, modifiedMillis: 0 };
            else { toast(errorMessage(e), "error"); return false; }
        }
        const choice = await diffDialog(doc.path, theirs.text, doc.model.getValue());
        if (choice === "mine") {
            this.saving.add(doc.path);
            try {
                const saved = await api.writeFile(this.project.id, doc.path, doc.model.getValue(), theirs.hash);
                this.markSaved(doc, saved.hash);
                toast(`${doc.path}을(를) 내 버전으로 저장했어요`, "success");
                return true;
            } catch (e) {
                toast(errorMessage(e), "error");
                return false;
            } finally {
                this.saving.delete(doc.path);
            }
        }
        if (choice === "theirs") {
            this.replaceText(doc, theirs.text);
            this.markSaved(doc, theirs.hash);
        }
        return false;
    }

    private async reload(doc: Doc): Promise<void> {
        if (!this.project) return;
        const file = await api.readFile(this.project.id, doc.path);
        this.replaceText(doc, file.text);
        this.markSaved(doc, file.hash);
    }

    private revert(doc: Doc): void {
        void this.reload(doc);
    }

    /** Replaces the text as one undoable edit. */
    private replaceText(doc: Doc, text: string): void {
        if (doc.model.getValue() === text) return;
        doc.model.pushEditOperations([], [{ range: doc.model.getFullModelRange(), text }], () => null);
    }

    private async createFile(): Promise<void> {
        if (!this.project) return;
        const values = await dialog("새 파일", [{ name: "path", label: "경로", placeholder: "lib/util.js" }], "만들기");
        const path = String(values?.path ?? "").replace(/^\/+/, "");
        if (!path) return;
        try {
            const saved = await api.writeFile(this.project.id, path, "", "");
            this.addDoc(saved.path, "", saved.hash);
            await this.refreshFiles();
            await this.openFile(saved.path);
        } catch (e) {
            toast(errorMessage(e), "error");
        }
    }

    private async renameFile(path: string): Promise<void> {
        if (!this.project) return;
        const values = await dialog("이름 바꾸기", [{ name: "to", label: "새 경로", value: path }], "바꾸기");
        const to = String(values?.to ?? "").replace(/^\/+/, "");
        if (!to || to === path) return;
        const doc = this.docs.get(path);
        if (doc && this.isDirty(doc) && !await this.save(path)) return;
        try {
            await api.renameFile(this.project.id, path, to);
            this.moveDoc(path, to);
            await this.refreshFiles();
        } catch (e) {
            toast(errorMessage(e), "error");
        }
    }

    private async deleteFile(path: string): Promise<void> {
        if (!this.project || !await confirmDialog("파일 삭제", `${path}을(를) 삭제할까요? 되돌릴 수 없어요.`, "삭제")) return;
        try {
            await api.deleteFile(this.project.id, path);
            this.dropDoc(path);
            await this.refreshFiles();
        } catch (e) {
            toast(errorMessage(e), "error");
        }
    }

    private moveDoc(from: string, to: string): void {
        const doc = this.docs.get(from);
        if (!doc) return;
        const text = doc.model.getValue();
        const wasActive = this.active === from;
        const tabIndex = this.tabs.indexOf(from);
        this.dropDoc(from);
        this.addDoc(to, text, doc.savedHash);
        if (tabIndex >= 0) this.tabs.splice(tabIndex, 0, to);
        if (wasActive) this.activate(to);
        else this.renderTabs();
    }

    private dropDoc(path: string): void {
        const doc = this.docs.get(path);
        if (!doc) return;
        this.tabs = this.tabs.filter((p) => p !== path);
        if (this.active === path) this.activate(this.tabs[0] ?? null);
        if (!doc.readOnly) doc.model.dispose();
        this.docs.delete(path);
        this.renderTabs();
    }

    private async quickOpen(): Promise<void> {
        const files = this.files.filter((f) => !f.isDirectory);
        if (files.length === 0) return;
        const path = await pick(files.map((f) => ({
            value: f.path,
            label: f.path,
            detail: f.path === this.project?.mainScript ? "메인 스크립트" : formatSize(f.size),
            icon: fileIcon(f.path),
        })), "열 파일 이름");
        if (path) await this.openFile(path);
    }

    // ------------------------------------------------------------------ compiling

    async compile(): Promise<CompileResult | null> {
        const project = this.project;
        if (!project) return null;
        if (!await this.saveAll()) return null;
        this.bottom.show("output");
        this.bottom.compileStarted(project.name);
        this.setCompiling(true);
        const wasOn = project.enabled && project.compiled;
        try {
            const result = await api.compile(project.id);
            this.showCompileResult(result);
            await this.refreshProjects();
            if (!result.success && wasOn)
                toast(`컴파일에 실패해서 ${project.name}이(가) 꺼졌어요. 오류를 고치고 다시 컴파일한 뒤 켜세요.`, "warning", 8000);
            return result;
        } catch (e) {
            this.bottom.compileFailed(errorMessage(e));
            return null;
        } finally {
            this.setCompiling(false);
        }
    }

    private showCompileResult(result: CompileResult): void {
        for (const doc of this.docs.values()) monaco.editor.setModelMarkers(doc.model, MARKER_OWNER, []);
        this.bottom.compileFinished(result);
        if (result.success) {
            toast("컴파일했어요", "success", 2500);
            return;
        }
        const path = result.errorPath && this.files.some((f) => f.path === result.errorPath) ? result.errorPath : this.project?.mainScript;
        if (!path || !result.errorLine) return;
        void this.openFile(path, { line: result.errorLine, column: result.errorColumn }).then(() => {
            const doc = this.docs.get(path);
            if (!doc) return;
            const line = Math.min(result.errorLine!, doc.model.getLineCount());
            monaco.editor.setModelMarkers(doc.model, MARKER_OWNER, [{
                severity: monaco.MarkerSeverity.Error,
                message: result.error ?? "컴파일 오류",
                source: "StarLight",
                startLineNumber: line,
                startColumn: result.errorColumn ?? 1,
                endLineNumber: line,
                endColumn: result.errorColumn ? result.errorColumn + 1 : doc.model.getLineMaxColumn(line),
            }]);
        });
    }

    // ------------------------------------------------------------------ live updates

    private connect(): void {
        this.closeStream?.();
        this.closeStream = api.stream(this.project?.id ?? null, {
            change: (change) => void this.onChange(change),
            log: (log: Log) => this.bottom.appendLog(log),
            appLog: (log: Log) => this.bottom.appendAppLog(log),
            status: (open) => this.setConnection(open),
        });
    }

    private setConnection(open: boolean): void {
        this.status.connection.replaceChildren(h("span", { class: "connection-dot " + (open ? "on" : "off") }), open ? "실시간 연결됨" : "연결 끊김");
    }

    private async onChange(change: Change): Promise<void> {
        const own = change.actor === "ide";
        const actor = ACTOR_NAMES[change.actor] ?? change.actor;
        if (change.type === "projectCreated" || change.type === "projectDeleted") {
            await this.refreshProjects();
            return;
        }
        if (change.projectId !== this.project?.id) {
            if (change.type === "enabledChanged" || change.type === "compiled") await this.refreshProjects();
            return;
        }
        switch (change.type) {
            case "fileWritten": {
                const doc = this.docs.get(change.path!);
                if (!this.files.some((f) => f.path === change.path)) await this.refreshFiles();
                if (!doc || doc.savedHash === change.hash || (own && this.saving.has(doc.path))) return;
                if (!this.isDirty(doc)) {
                    await this.reload(doc);
                    if (!own) toast(`${actor}이(가) ${change.path}을(를) 수정했어요`, "info");
                } else {
                    doc.changedElsewhere = true;
                    this.renderTabs();
                    this.renderBanner();
                    toast(`${actor}이(가) 저장하지 않은 ${change.path}을(를) 수정했어요`, "warning", 6000);
                }
                return;
            }
            case "fileDeleted":
                await this.refreshFiles();
                if (!own && this.docs.has(change.path!)) {
                    const doc = this.docs.get(change.path!)!;
                    if (this.isDirty(doc)) doc.changedElsewhere = true;
                    else this.dropDoc(change.path!);
                    toast(`${actor}이(가) ${change.path}을(를) 삭제했어요`, "warning");
                }
                return;
            case "fileRenamed":
                if (!own) this.moveDoc(change.from!, change.to!);
                await this.refreshFiles();
                return;
            case "compiled":
                await this.refreshProjects();
                if (!own) toast(`${actor}이(가) 컴파일했어요${change.success ? "" : " (실패)"}`, change.success ? "info" : "warning");
                return;
            case "enabledChanged":
                await this.refreshProjects();
                return;
            case "eventsChanged":
                this.project = await api.project(this.project.id);
                this.side.onProjectChanged();
                return;
            case "debugMessageSent":
                if (!own) this.side.showRemoteDebug(change);
                return;
        }
    }

    // ------------------------------------------------------------------ event snippets

    /** Typing an event's function name, such as onMessage, offers the function with its documented arguments. */
    private registerEventSnippets(): void {
        monaco.languages.registerCompletionItemProvider("javascript", {
            provideCompletionItems: (model, position) => {
                const word = model.getWordUntilPosition(position);
                const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
                const exported = /neon/i.test(this.project?.languageId ?? "");
                const suggestions = this.events.map((event) => ({
                    label: { label: event.functionName, description: "이벤트 함수" },
                    filterText: event.functionName,
                    kind: monaco.languages.CompletionItemKind.Event,
                    detail: `${event.name} (${event.id})`,
                    documentation: event.comment ?? undefined,
                    insertText: eventSnippet(event, exported),
                    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                    range,
                    sortText: "~" + event.functionName,
                }));
                return { suggestions };
            },
        });
    }

    insertEventFunction(event: EventInfo): void {
        if (!this.active) return void toast("먼저 파일을 여세요", "warning");
        const model = this.editor.getModel()!;
        const line = model.getLineCount();
        this.editor.setPosition({ lineNumber: line, column: model.getLineMaxColumn(line) });
        const controller = this.editor.getContribution("snippetController2") as unknown as { insert(text: string): void } | null;
        controller?.insert("\n\n" + eventSnippet(event, /neon/i.test(this.project?.languageId ?? "")));
        this.editor.focus();
    }
}

export function eventSnippet(event: EventInfo, exported: boolean): string {
    const docLines = [
        ...(event.comment ? event.comment.split("\n").map((l) => " * " + l.replace(/\$/g, "\\$").replace(/}/g, "\\}")) : []),
        ...event.args.map((a) => ` * @param {${a.tsType}} ${a.name}`),
    ];
    const doc = docLines.length ? `/**\n${docLines.join("\n")}\n */\n` : "";
    return `${doc}${exported ? "export " : ""}function ${event.functionName}(${event.args.map((a) => a.name).join(", ")}) {\n\t$0\n}`;
}

/** Shows the file's current text (left) against the edits here (right). */
function diffDialog(path: string, theirs: string, mine: string): Promise<"mine" | "theirs" | null> {
    return new Promise((resolve) => {
        const host = h("div", { class: "diff-host" });
        const language = languageOf(path);
        const original = monaco.editor.createModel(theirs, language);
        const modified = monaco.editor.createModel(mine, language);
        const diff = monaco.editor.createDiffEditor(host, { automaticLayout: true, ...editorFont, readOnly: true, renderSideBySide: true, minimap: { enabled: false } });
        diff.setModel({ original, modified });
        const close = (result: "mine" | "theirs" | null) => {
            diff.dispose();
            original.dispose();
            modified.dispose();
            overlay.remove();
            resolve(result);
        };
        const overlay = h("div", { class: "overlay" },
            h("div", { class: "dialog dialog-wide", role: "dialog", "aria-modal": "true" },
                h("h2", {}, `${path} 충돌`),
                h("p", { class: "dialog-description" }, "다른 곳에서 바뀐 버전(왼쪽)과 이 IDE에서 고친 버전(오른쪽)이에요. 남길 쪽을 고르세요."),
                host,
                h("div", { class: "dialog-actions" },
                    h("button", { type: "button", class: "secondary", onClick: () => close(null) }, "취소"),
                    h("button", { type: "button", class: "secondary", onClick: () => close("theirs") }, "바뀐 버전 받기"),
                    h("button", { type: "button", class: "primary", onClick: () => close("mine") }, "내 버전으로 저장"))));
        document.body.appendChild(overlay);
    });
}

function splitter(target: "sidebar" | "side"): HTMLElement {
    const element = h("div", { class: `splitter splitter-${target}`, role: "separator", "aria-orientation": "vertical" });
    element.addEventListener("pointerdown", (start) => {
        const root = element.closest(".ide") as HTMLElement;
        const variable = target === "sidebar" ? "--sidebar-width" : "--side-width";
        const initial = parseFloat(getComputedStyle(root).getPropertyValue(variable)) || 280;
        element.setPointerCapture(start.pointerId);
        const move = (e: PointerEvent) => {
            const delta = target === "sidebar" ? e.clientX - start.clientX : start.clientX - e.clientX;
            const width = Math.max(180, Math.min(560, initial + delta));
            root.style.setProperty(variable, `${width}px`);
            localStorage.setItem("ide." + variable, String(width));
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", () => element.removeEventListener("pointermove", move), { once: true });
    });
    return element;
}

function restoreSizes(root: HTMLElement): void {
    for (const variable of ["--sidebar-width", "--side-width", "--bottom-height"]) {
        const value = localStorage.getItem("ide." + variable);
        if (value) root.style.setProperty(variable, `${value}px`);
    }
}

function languageOf(path: string): string {
    if (/\.m?js$|\.cjs$/.test(path)) return "javascript";
    if (path.endsWith(".ts")) return "typescript";
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".md")) return "markdown";
    return "plaintext";
}

function languageLabel(path: string): string {
    return { javascript: "JavaScript", typescript: "TypeScript", json: "JSON", markdown: "Markdown", plaintext: "텍스트" }[languageOf(path)] ?? "";
}

function readJson<T>(key: string): T | null {
    try {
        return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
    } catch {
        return null;
    }
}

/** A square with the project's initial. */
function avatar(name: string): HTMLElement {
    return h("span", { class: "avatar", "aria-hidden": "true" }, [...name][0]?.toUpperCase() ?? "?");
}

/** Not compiled means off in StarLight, but worth pointing out: it can't be turned on until compiled. */
function stateClass(project: Project): string {
    if (!project.compiled) return "pending";
    return project.enabled ? "on" : "off";
}

function stateLabel(project: Project): string {
    if (!project.compiled) return "컴파일 필요";
    return project.enabled ? "실행 중" : "꺼짐";
}

function fileIcon(path: string): SVGSVGElement {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const svg = icon("file", 15);
    svg.classList.add("file-icon", "ft-" + ({ js: "js", mjs: "js", cjs: "js", ts: "ts", json: "json", md: "md" }[ext] ?? "other"));
    return svg;
}

function formatSize(bytes: number): string {
    return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function shortLanguage(id: string): string {
    if (/neon/i.test(id)) return "NeonJS";
    if (/rhino/i.test(id)) return "Rhino";
    return id;
}

/** StarLight's own files in the project directory. */
function isHidden(path: string): boolean {
    return /^(project\.json|config\.json|logs\.json)$/.test(path) || path.startsWith("debugroom");
}

export function errorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

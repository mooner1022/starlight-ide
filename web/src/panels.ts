// The panel below the editor (output, logs, search, problems) and the one on the right (debug room, events).

import { api, type Change, type CompileResult, type Log } from "./api";
import { clear, formatTime, h, icon, iconButton, logo, sparkle } from "./dom";
import type { Ide } from "./ide";
import { errorMessage } from "./ide";
import { monaco } from "./monaco";
import { toast } from "./ui";

type BottomTab = "output" | "logs" | "search" | "problems";

const LOG_LEVELS = ["VERBOSE", "DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"];
const MAX_LOG_ROWS = 2000;

export class BottomPanel {
    readonly root = h("section", { class: "bottom-panel card" });
    private tab: BottomTab = "output";
    private readonly tabs = h("div", { class: "panel-tabs", role: "tablist" });
    private readonly actions = h("div", { class: "panel-actions" });
    private readonly bodies: Record<BottomTab, HTMLElement> = {
        output: h("div", { class: "panel-body output" }),
        logs: h("div", { class: "panel-body logs" }),
        search: h("div", { class: "panel-body search" }),
        problems: h("div", { class: "panel-body problems" }),
    };
    private minLevel = Number(localStorage.getItem("ide.logLevel") ?? 2);
    private follow = true;
    /** Logs of the open project, or of StarLight and all its plugins. */
    private logSource: "project" | "app" = localStorage.getItem("ide.logSource") === "app" ? "app" : "project";
    private readonly projectLogs = h("div", { class: "log-list" });
    private readonly appLogList = h("div", { class: "log-list" });
    private appLogsLoaded = false;
    private readonly searchInput = h("input", { class: "search-input", placeholder: "프로젝트에서 검색", spellcheck: false });
    private readonly searchRegex = h("input", { type: "checkbox" });
    private readonly searchCase = h("input", { type: "checkbox" });
    private readonly searchResults = h("div", { class: "search-results" });

    constructor(private readonly ide: Ide) {
        this.root.append(
            splitterHorizontal(),
            h("div", { class: "panel-header" }, this.tabs, this.actions),
            ...Object.values(this.bodies));
        this.bodies.logs.addEventListener("scroll", () => {
            const body = this.bodies.logs;
            this.follow = body.scrollTop + body.clientHeight >= body.scrollHeight - 8;
        });
        this.searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") void this.search(); });
        this.bodies.search.append(
            h("div", { class: "search-bar" }, icon("search", 14), this.searchInput,
                h("label", { class: "toggle", title: "정규식" }, this.searchRegex, h("span", {}, ".*")),
                h("label", { class: "toggle", title: "대소문자 구분" }, this.searchCase, h("span", {}, "Aa"))),
            this.searchResults);
        this.bodies.output.append(h("div", { class: "panel-placeholder" }, "컴파일 결과가 여기에 표시돼요. Ctrl+Shift+B로 컴파일하세요."));
        this.bodies.logs.append(this.projectLogs, this.appLogList);
        this.projectLogs.hidden = this.logSource !== "project";
        this.appLogList.hidden = this.logSource !== "app";
        this.root.classList.toggle("collapsed", localStorage.getItem("ide.bottomCollapsed") === "true");
        this.render();
    }

    /** Shows [tab], opening the panel if it is collapsed. */
    show(tab: BottomTab): void {
        this.tab = tab;
        this.setCollapsed(false);
    }

    /** Collapses the panel to its header, or opens it again. */
    toggleCollapsed(): void {
        this.setCollapsed(!this.root.classList.contains("collapsed"));
    }

    private setCollapsed(collapsed: boolean): void {
        this.root.classList.toggle("collapsed", collapsed);
        localStorage.setItem("ide.bottomCollapsed", String(collapsed));
        this.render();
    }

    private render(): void {
        const tab = this.tab;
        const collapsed = this.root.classList.contains("collapsed");
        const labels: Record<BottomTab, [string, string]> = { output: ["terminal", "출력"], logs: ["bolt", "로그"], search: ["search", "검색"], problems: ["warning", "문제"] };
        clear(this.tabs);
        for (const [key, [iconName, label]] of Object.entries(labels) as [BottomTab, [string, string]][]) {
            this.tabs.appendChild(h("button", {
                type: "button", class: "panel-tab" + (key === tab ? " active" : ""), role: "tab", "aria-selected": key === tab,
                onClick: () => this.show(key),
            }, key === tab ? sparkle(10) : icon(iconName, 14), label));
        }
        for (const [key, body] of Object.entries(this.bodies)) body.hidden = key !== tab;
        clear(this.actions);
        if (tab === "logs" && !collapsed) {
            const sources = h("div", { class: "segmented", role: "group", "aria-label": "로그 범위" },
                ...([["project", "프로젝트"], ["app", "앱 전체"]] as const).map(([value, label]) => h("button", {
                    type: "button", class: value === this.logSource ? "selected" : "", "aria-pressed": value === this.logSource,
                    onClick: () => void this.setLogSource(value),
                }, label)));
            const level = h("select", { class: "small-select", title: "표시할 최소 수준" },
                ...LOG_LEVELS.map((l, i) => h("option", { value: String(i), selected: i === this.minLevel }, l)));
            level.addEventListener("change", () => {
                this.minLevel = Number(level.value);
                localStorage.setItem("ide.logLevel", level.value);
                this.applyLogFilter();
            });
            this.actions.append(sources, level, iconButton("clear", "지우기", () => clear(this.logSource === "app" ? this.appLogList : this.projectLogs)));
            if (this.logSource === "app" && !this.appLogsLoaded) void this.loadAppLogs();
        }
        if (tab === "search" && !collapsed) this.searchInput.focus();
        if (tab === "problems") this.renderProblems();
        this.actions.append(collapsed
            ? iconButton("chevronUp", "패널 펼치기 (Ctrl+J)", () => this.toggleCollapsed())
            : iconButton("chevronDown", "패널 접기 (Ctrl+J)", () => this.toggleCollapsed()));
    }

    private async setLogSource(source: "project" | "app"): Promise<void> {
        this.logSource = source;
        localStorage.setItem("ide.logSource", source);
        this.projectLogs.hidden = source !== "project";
        this.appLogList.hidden = source !== "app";
        this.render();
        this.follow = true;
        this.bodies.logs.scrollTop = this.bodies.logs.scrollHeight;
    }

    private async loadAppLogs(): Promise<void> {
        this.appLogsLoaded = true;
        try {
            const logs = await api.appLogs();
            // Logs that arrived through the stream meanwhile are kept after the loaded ones.
            const streamed = Array.from(this.appLogList.children);
            clear(this.appLogList);
            logs.slice(-1000).forEach((log) => this.appendTo(this.appLogList, log));
            this.appLogList.append(...streamed);
        } catch {
            this.appLogsLoaded = false;
        }
    }

    async onProjectChanged(): Promise<void> {
        clear(this.projectLogs);
        clear(this.searchResults);
        const project = this.ide.project;
        if (!project) return;
        try {
            const logs = await api.logs(project.id);
            logs.slice(-500).forEach((log) => this.appendLog(log));
        } catch { /* the stream brings new ones */ }
    }

    // ------------------------------------------------------------------ output

    compileStarted(name: string): void {
        clear(this.bodies.output);
        this.bodies.output.append(h("div", { class: "output-line running" }, h("span", { class: "spinner" }), `${name} 컴파일 중...`));
    }

    compileFinished(result: CompileResult): void {
        clear(this.bodies.output);
        const location = result.errorLine ? ` (${result.errorPath ?? this.ide.project?.mainScript}:${result.errorLine}${result.errorColumn ? ":" + result.errorColumn : ""})` : "";
        this.bodies.output.append(result.success
            ? h("div", { class: "output-line success" }, icon("check", 14), "컴파일 성공")
            : h("div", { class: "output-line error" }, icon("error", 14), `컴파일 실패${location}`));
        if (result.error) this.bodies.output.append(h("pre", { class: "output-error" }, result.error));
        for (const log of result.logs) this.bodies.output.append(logRow(log));
    }

    compileFailed(message: string): void {
        clear(this.bodies.output);
        this.bodies.output.append(h("div", { class: "output-line error" }, icon("error", 14), message));
    }

    // ------------------------------------------------------------------ logs

    /** A log of the open project. */
    appendLog(log: Log): void {
        this.appendTo(this.projectLogs, log);
    }

    /** A log of StarLight or one of its plugins. */
    appendAppLog(log: Log): void {
        this.appendTo(this.appLogList, log);
    }

    private appendTo(list: HTMLElement, log: Log): void {
        const row = logRow(log);
        row.hidden = LOG_LEVELS.indexOf(log.type) < this.minLevel;
        list.appendChild(row);
        while (list.childElementCount > MAX_LOG_ROWS) list.firstElementChild?.remove();
        if (this.follow && !list.hidden) this.bodies.logs.scrollTop = this.bodies.logs.scrollHeight;
    }

    private applyLogFilter(): void {
        for (const list of [this.projectLogs, this.appLogList])
            for (const row of Array.from(list.children) as HTMLElement[])
                row.hidden = LOG_LEVELS.indexOf(row.dataset.level ?? "") < this.minLevel;
    }

    // ------------------------------------------------------------------ search

    private async search(): Promise<void> {
        const project = this.ide.project;
        const query = this.searchInput.value;
        if (!project || !query) return;
        clear(this.searchResults);
        try {
            const hits = await api.search(project.id, query, this.searchRegex.checked, !this.searchCase.checked);
            if (hits.length === 0) {
                this.searchResults.append(h("div", { class: "panel-placeholder" }, "결과가 없어요"));
                return;
            }
            let current = "";
            for (const hit of hits) {
                if (hit.path !== current) {
                    current = hit.path;
                    this.searchResults.append(h("div", { class: "result-file" }, icon("file", 14), hit.path));
                }
                this.searchResults.append(h("button", {
                    type: "button", class: "result-line",
                    onClick: () => void this.ide.openFile(hit.path, { line: hit.line }),
                }, h("span", { class: "result-number" }, String(hit.line)), h("span", { class: "result-text" }, hit.text.trim())));
            }
        } catch (e) {
            this.searchResults.append(h("div", { class: "panel-placeholder error-text" }, errorMessage(e)));
        }
    }

    // ------------------------------------------------------------------ problems

    renderProblems(): void {
        if (this.tab !== "problems") return;
        const body = this.bodies.problems;
        clear(body);
        const markers = this.ide.projectMarkers()
            .filter((m) => m.severity >= monaco.MarkerSeverity.Warning)
            .sort((a, b) => b.severity - a.severity || a.resource.path.localeCompare(b.resource.path) || a.startLineNumber - b.startLineNumber);
        if (markers.length === 0) {
            body.append(h("div", { class: "panel-placeholder" }, "문제가 없어요"));
            return;
        }
        for (const marker of markers) {
            const path = this.ide.pathOf(marker.resource);
            if (!path) continue;
            const isError = marker.severity === monaco.MarkerSeverity.Error;
            body.append(h("button", {
                type: "button", class: "problem-row",
                onClick: () => void this.ide.openFile(path, { line: marker.startLineNumber, column: marker.startColumn }),
            }, icon(isError ? "error" : "warning", 14), h("span", { class: "problem-message" }, marker.message),
                h("span", { class: "problem-location" }, `${path}:${marker.startLineNumber}`)));
        }
    }
}

export class SidePanel {
    readonly root = h("aside", { class: "side-panel card" });
    private tab: "debug" | "events" = "debug";
    private readonly tabs = h("div", { class: "panel-tabs", role: "tablist" });
    private readonly chat = h("div", { class: "chat-log", "aria-live": "polite" });
    private readonly input = h("textarea", { class: "chat-input", rows: 2, placeholder: "봇에게 보낼 메시지 (Enter로 전송)" });
    private readonly sender = h("input", { placeholder: "디버그룸 설정", value: localStorage.getItem("ide.sender") ?? "" });
    private readonly room = h("input", { placeholder: "디버그룸 설정", value: localStorage.getItem("ide.room") ?? "" });
    private readonly group = h("input", { type: "checkbox", checked: localStorage.getItem("ide.group") === "true" });
    private readonly debugBody: HTMLElement;
    private readonly eventsBody = h("div", { class: "events-body" });
    private readonly roomTitle = h("div", { class: "room-title" });
    private sending = false;
    /** Who sent the last message, to group consecutive ones. */
    private lastAuthor: string | null = null;

    constructor(private readonly ide: Ide) {
        this.input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                void this.send();
            }
        });
        for (const [element, key] of [[this.sender, "ide.sender"], [this.room, "ide.room"]] as const)
            element.addEventListener("change", () => localStorage.setItem(key, element.value));
        this.group.addEventListener("change", () => localStorage.setItem("ide.group", String(this.group.checked)));

        this.room.addEventListener("input", () => this.renderRoomTitle());
        this.group.addEventListener("change", () => this.renderRoomTitle());
        this.debugBody = h("div", { class: "debug-body" },
            h("div", { class: "room-bar" }, h("span", { class: "room-avatar" }, logo(16)), this.roomTitle),
            this.chat,
            h("details", { class: "chat-options" },
                h("summary", {}, "보내는 사람·방"),
                h("label", { class: "field compact" }, h("span", {}, "보내는 사람"), this.sender),
                h("label", { class: "field compact" }, h("span", {}, "방 이름"), this.room),
                h("label", { class: "check-row" }, this.group, h("span", {}, "단체방"))),
            h("div", { class: "chat-compose" }, this.input,
                h("button", { type: "button", class: "send-button", title: "보내기 (Enter)", "aria-label": "보내기", onClick: () => void this.send() }, icon("send"))));
        this.root.append(h("div", { class: "panel-header" }, this.tabs), this.debugBody, this.eventsBody);
        this.show("debug");
        this.renderChatPlaceholder();
        this.renderRoomTitle();
    }

    private renderRoomTitle(): void {
        this.roomTitle.replaceChildren(
            h("span", { class: "room-name" }, this.room.value || "디버그룸"),
            h("span", { class: "room-sub" }, `${this.ide.project?.name ?? "프로젝트 없음"} · ${this.group.checked ? "단체방" : "1:1 채팅"}`));
    }

    show(tab: "debug" | "events"): void {
        this.tab = tab;
        clear(this.tabs);
        for (const [key, iconName, label] of [["debug", "chat", "디버그룸"], ["events", "bolt", "이벤트"]] as const) {
            this.tabs.appendChild(h("button", {
                type: "button", class: "panel-tab" + (key === tab ? " active" : ""), role: "tab", "aria-selected": key === tab,
                onClick: () => this.show(key),
            }, key === tab ? sparkle(10) : icon(iconName, 14), label));
        }
        this.debugBody.hidden = tab !== "debug";
        this.eventsBody.hidden = tab !== "events";
        if (tab === "events") this.renderEvents();
    }

    onProjectChanged(): void {
        clear(this.chat);
        this.lastAuthor = null;
        this.renderChatPlaceholder();
        this.renderRoomTitle();
        if (this.tab === "events") this.renderEvents();
    }

    // ------------------------------------------------------------------ debug room

    private renderChatPlaceholder(): void {
        if (this.chat.childElementCount > 0) return;
        this.chat.append(h("div", { class: "chat-placeholder" },
            h("div", { class: "placeholder-icon" }, icon("chat", 22)),
            h("p", { class: "placeholder-title" }, "봇과 대화해 보세요"),
            h("p", {}, "앱의 디버그룸처럼 메시지를 보내고 답장을 바로 확인해요."),
            h("div", { class: "suggestions" },
                ...["!핑", "안녕", "!도움말"].map((text) => h("button", {
                    type: "button", class: "suggestion",
                    onClick: () => { this.input.value = text; void this.send(); },
                }, text))),
            h("p", { class: "muted" }, "프로젝트가 컴파일되어 있고 메시지 이벤트를 받아야 해요.")));
    }

    private async send(): Promise<void> {
        const project = this.ide.project;
        const text = this.input.value.trim();
        if (!project || !text || this.sending) return;
        this.sending = true;
        this.chat.querySelector(".chat-placeholder")?.remove();
        this.input.value = "";
        this.bubble("user", text);
        const typing = h("div", { class: "msg msg-bot" },
            h("span", { class: "msg-avatar" }, logo(14)),
            h("div", { class: "msg-body" }, h("div", { class: "bubble typing" }, h("span"), h("span"), h("span"))));
        this.chat.append(typing);
        this.scrollChat();
        try {
            const reply = await api.debug(project.id, text, {
                sender: this.sender.value || undefined,
                room: this.room.value || undefined,
                isGroupChat: this.group.checked,
            });
            typing.remove();
            reply.replies.forEach((r) => this.bubble("bot", r));
            if (reply.error) this.bubble("error", reply.error);
            if (reply.replies.length === 0 && !reply.error) this.note("답장이 없어요");
            if (reply.logs.length) this.note(`로그 ${reply.logs.length}줄 · 아래 로그 패널에서 볼 수 있어요`);
        } catch (e) {
            typing.remove();
            this.bubble("error", errorMessage(e));
        } finally {
            this.sending = false;
            this.scrollChat();
        }
    }

    /** A debug room exchange another tool (the AI) made. */
    showRemoteDebug(change: Change & { message?: string; replies?: string[] }): void {
        if (!change.message) return;
        this.chat.querySelector(".chat-placeholder")?.remove();
        this.note(`${change.actor === "mcp" ? "AI(MCP)" : change.actor}이(가) 보낸 메시지`);
        this.bubble("user remote", change.message);
        (change.replies ?? []).forEach((r) => this.bubble("bot", r));
        this.scrollChat();
    }

    /** A message; consecutive ones of the same author share the avatar and name. */
    private bubble(kind: "user" | "user remote" | "bot" | "error", text: string): void {
        const author = kind === "error" ? "bot" : kind;
        const first = this.lastAuthor !== author;
        this.lastAuthor = author;
        const time = h("span", { class: "msg-time" }, new Date().toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }));
        const bubble = h("div", { class: "bubble" + (kind === "error" ? " error" : "") }, text);
        if (kind.startsWith("user")) {
            this.chat.append(h("div", { class: "msg msg-user" + (kind === "user remote" ? " remote" : "") + (first ? " first" : "") }, time, bubble));
            return;
        }
        this.chat.append(h("div", { class: "msg msg-bot" + (first ? " first" : "") },
            first ? h("span", { class: "msg-avatar" }, logo(14)) : h("span", { class: "msg-avatar-space" }),
            h("div", { class: "msg-body" }, first ? h("span", { class: "msg-name" }, this.ide.project?.name ?? "봇") : null,
                h("div", { class: "msg-line" }, bubble, time))));
    }

    private note(text: string): void {
        this.lastAuthor = null;
        this.chat.append(h("div", { class: "chat-note" }, text));
    }

    private scrollChat(): void {
        this.chat.scrollTop = this.chat.scrollHeight;
    }

    // ------------------------------------------------------------------ events

    private renderEvents(): void {
        clear(this.eventsBody);
        const project = this.ide.project;
        if (!project) return;
        const allowed = new Set(project.allowedEvents ?? []);
        this.eventsBody.append(h("p", { class: "events-hint" }, "프로젝트가 받을 이벤트를 고르세요. 함수 이름을 누르면 에디터에 함수를 넣어요."));
        for (const event of this.ide.events) {
            const toggle = h("input", { type: "checkbox", class: "switch", checked: allowed.has(event.id), "aria-label": event.name });
            toggle.addEventListener("change", async () => {
                try {
                    const result = await api.updateEvents(project.id, toggle.checked ? [event.id] : [], toggle.checked ? [] : [event.id]);
                    project.allowedEvents = result.allowed;
                    toggle.closest(".event-row")?.classList.toggle("allowed", toggle.checked);
                } catch (e) {
                    toggle.checked = !toggle.checked;
                    toast(errorMessage(e), "error");
                }
            });
            this.eventsBody.append(h("div", { class: "event-row" + (allowed.has(event.id) ? " allowed" : "") },
                h("div", { class: "event-text" },
                    h("div", { class: "event-name" }, event.name),
                    h("button", { type: "button", class: "event-function", title: "에디터에 넣기", onClick: () => this.ide.insertEventFunction(event) },
                        `${event.functionName}(${event.args.map((a) => a.name).join(", ")})`),
                    h("div", { class: "event-id" }, event.id)),
                toggle));
        }
    }
}

function logRow(log: Log): HTMLElement {
    return h("div", { class: `log-row log-${log.type.toLowerCase()}`, "data-level": log.type },
        h("span", { class: "log-time" }, formatTime(log.millis)),
        h("span", { class: "log-level" }, log.type === "VERBOSE" ? "VERB" : log.type === "CRITICAL" ? "CRIT" : log.type),
        h("span", { class: "log-tag" }, log.tag),
        h("span", { class: "log-message" }, log.message));
}

function splitterHorizontal(): HTMLElement {
    const element = h("div", { class: "splitter splitter-bottom", role: "separator", "aria-orientation": "horizontal" });
    element.addEventListener("pointerdown", (start) => {
        const root = element.closest(".ide") as HTMLElement;
        const initial = parseFloat(getComputedStyle(root).getPropertyValue("--bottom-height")) || 220;
        element.setPointerCapture(start.pointerId);
        const move = (e: PointerEvent) => {
            const height = Math.max(90, Math.min(window.innerHeight - 200, initial + start.clientY - e.clientY));
            root.style.setProperty("--bottom-height", `${height}px`);
            localStorage.setItem("ide.--bottom-height", String(height));
        };
        element.addEventListener("pointermove", move);
        element.addEventListener("pointerup", () => element.removeEventListener("pointermove", move), { once: true });
    });
    return element;
}

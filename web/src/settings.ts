// The IDE's own settings, kept in this browser.

import { button, h, icon, sparkle } from "./dom";
import { ACCENTS, applyCssVariables, palette, systemTheme, type AccentName, type ThemeName } from "./theme";

export type ThemeMode = "system" | ThemeName;

export interface Settings {
    themeMode: ThemeMode;
    accent: AccentName;
    fontSize: number;
    tabSize: 2 | 4;
    wordWrap: boolean;
    minimap: boolean;
    ligatures: boolean;
    /** Which key sends a debug room message; the other one adds a line. */
    sendWith: "enter" | "ctrlEnter";
}

export const DEFAULT_SETTINGS: Settings = {
    themeMode: "system",
    accent: "sand",
    fontSize: 13.5,
    tabSize: 4,
    wordWrap: false,
    minimap: true,
    ligatures: true,
    sendWith: "enter",
};

const KEY = "ide.settings";
const FONT_SIZES = [12, 13, 13.5, 14, 15, 16, 18];

export function loadSettings(): Settings {
    let saved: Partial<Settings> = {};
    try {
        saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    } catch { /* defaults */ }
    // The theme chosen before settings existed.
    const legacy = localStorage.getItem("ide.theme");
    if (!saved.themeMode && (legacy === "dark" || legacy === "light")) saved.themeMode = legacy;
    return { ...DEFAULT_SETTINGS, ...saved };
}

export function saveSettings(settings: Settings): void {
    localStorage.setItem(KEY, JSON.stringify(settings));
}

export function themeOf(settings: Settings): ThemeName {
    return settings.themeMode === "system" ? systemTheme() : settings.themeMode;
}

/** Applies the colors of [settings] to the page. */
export function applyPageTheme(settings: Settings): void {
    const theme = themeOf(settings);
    applyCssVariables(theme, palette(theme, settings.accent));
}

/** The settings dialog; every change applies at once through [onChange]. */
export function openSettings(current: Settings, onChange: (settings: Settings) => void): void {
    let settings = { ...current };
    const body = h("div", { class: "settings-body" });
    const update = (patch: Partial<Settings>) => {
        settings = { ...settings, ...patch };
        saveSettings(settings);
        onChange(settings);
        render();
    };

    const segmented = <T extends string | number>(value: T, options: [T, string][], onPick: (value: T) => void) =>
        h("div", { class: "segmented" }, ...options.map(([option, label]) => h("button", {
            type: "button", class: option === value ? "selected" : "", "aria-pressed": option === value,
            onClick: () => onPick(option),
        }, label)));
    const toggle = (checked: boolean, onToggle: (checked: boolean) => void) => {
        const input = h("input", { type: "checkbox", class: "switch", checked });
        input.addEventListener("change", () => onToggle(input.checked));
        return input;
    };
    const row = (label: string, hint: string | null, control: Node) =>
        h("div", { class: "settings-row" }, h("div", { class: "settings-label" }, h("span", {}, label), hint ? h("small", {}, hint) : null), control);
    const section = (title: string, ...rows: Node[]) =>
        h("section", { class: "settings-section" }, h("h3", {}, sparkle(10), title), ...rows);

    const render = () => {
        const theme = themeOf(settings);
        const fontIndex = FONT_SIZES.indexOf(settings.fontSize);
        body.replaceChildren(
            section("화면",
                row("테마", settings.themeMode === "system" ? `지금은 ${theme === "dark" ? "다크" : "라이트"} (시스템 설정을 따라요)` : null,
                    segmented<ThemeMode>(settings.themeMode, [["system", "시스템"], ["dark", "다크"], ["light", "라이트"]], (themeMode) => update({ themeMode }))),
                row("강조 색", "버튼, 커서, 선택한 항목의 색이에요.",
                    h("div", { class: "swatches" }, ...(Object.entries(ACCENTS) as [AccentName, (typeof ACCENTS)[AccentName]][]).map(([name, accent]) =>
                        h("button", {
                            type: "button", class: "swatch" + (name === settings.accent ? " selected" : ""), title: accent.label,
                            "aria-label": accent.label, "aria-pressed": name === settings.accent,
                            style: `--swatch: ${accent[theme][0]}`,
                            onClick: () => update({ accent: name }),
                        }, h("span", { class: "swatch-color" }), h("span", { class: "swatch-label" }, accent.label)))))),
            section("에디터",
                row("글꼴 크기", null, h("div", { class: "stepper" },
                    button(icon("chevronDown", 14), () => update({ fontSize: FONT_SIZES[Math.max(0, fontIndex - 1)] }), { class: "icon-button", "aria-label": "작게", disabled: fontIndex <= 0 }),
                    h("span", { class: "stepper-value" }, `${settings.fontSize}px`),
                    button(icon("chevronUp", 14), () => update({ fontSize: FONT_SIZES[Math.min(FONT_SIZES.length - 1, fontIndex + 1)] }), { class: "icon-button", "aria-label": "크게", disabled: fontIndex >= FONT_SIZES.length - 1 }))),
                row("탭 크기", "새로 여는 파일과 열린 파일의 들여쓰기 칸 수예요.", segmented<number>(settings.tabSize, [[2, "2칸"], [4, "4칸"]], (tabSize) => update({ tabSize: tabSize as 2 | 4 }))),
                row("자동 줄 바꿈", "긴 줄을 화면 너비에서 접어 보여 줘요.", toggle(settings.wordWrap, (wordWrap) => update({ wordWrap }))),
                row("미니맵", null, toggle(settings.minimap, (minimap) => update({ minimap }))),
                row("글꼴 합자", "=> 와 === 같은 기호를 이어 그려요.", toggle(settings.ligatures, (ligatures) => update({ ligatures })))),
            section("디버그룸",
                row("보내기", settings.sendWith === "enter" ? "Shift+Enter로 줄을 바꿔요." : "Enter로 줄을 바꿔요.",
                    segmented(settings.sendWith, [["enter", "Enter"], ["ctrlEnter", "Ctrl+Enter"]], (sendWith) => update({ sendWith })))));
    };

    const close = () => {
        overlay.remove();
        document.removeEventListener("keydown", onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.stopPropagation();
            close();
        }
    };
    const overlay = h("div", { class: "overlay", onMousedown: (e: Event) => { if (e.target === overlay) close(); } },
        h("div", { class: "dialog settings-dialog", role: "dialog", "aria-modal": "true", "aria-label": "설정" },
            h("div", { class: "settings-header" }, h("h2", {}, "설정"), button(icon("close"), close, { class: "icon-button", "aria-label": "닫기" })),
            body,
            h("div", { class: "dialog-actions" },
                h("button", { type: "button", class: "secondary", onClick: () => update({ ...DEFAULT_SETTINGS }) }, "기본값으로"),
                h("button", { type: "button", class: "primary", onClick: close }, "닫기"))));
    render();
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey, true);
    (overlay.querySelector(".segmented button.selected") as HTMLElement | null)?.focus();
}

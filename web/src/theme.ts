// One palette for the whole IDE: the page reads it as CSS variables and Monaco gets a theme built from the same values,
// so the editor, its widgets (suggest, hover, find) and the panels around it match.

export type ThemeName = "dark" | "light";

interface Palette {
    /** The night sky behind the floating panels. */
    canvas: string;
    /** Glows on the canvas. */
    glowA: string;
    glowB: string;
    /** Panel background. */
    bg: string;
    /** Sidebars and panels. */
    surface: string;
    /** Raised elements: tabs, inputs, hovered rows. */
    surface2: string;
    /** Selected rows, pressed buttons. */
    surface3: string;
    editor: string;
    border: string;
    borderStrong: string;
    text: string;
    muted: string;
    faint: string;
    accent: string;
    /** Second stop of accent gradients. */
    accent2: string;
    accentText: string;
    /** StarLight's star, used sparingly: the logo, the cursor, the active tab. */
    star: string;
    success: string;
    warning: string;
    error: string;
    info: string;
    selection: string;
    lineHighlight: string;
    shadow: string;
    syntax: {
        keyword: string;
        string: string;
        number: string;
        comment: string;
        type: string;
        func: string;
        regexp: string;
        delimiter: string;
        constant: string;
    };
}

// StarLight's own look: warm charcoal, sand beige, white type.
const dark: Palette = {
    canvas: "#0a0909",
    glowA: "#5a4d44",
    glowB: "#2c2733",
    bg: "#151314",
    surface: "#171516",
    surface2: "#211e1f",
    surface3: "#2b2829",
    editor: "#131112",
    border: "#262223",
    borderStrong: "#3a3431",
    text: "#f3efe9",
    muted: "#aaa29a",
    faint: "#6e6762",
    accent: "#dcc19b",
    accent2: "#c7a77c",
    accentText: "#2a221b",
    star: "#dcc19b",
    success: "#a9cf95",
    warning: "#e7b877",
    error: "#ec8c80",
    info: "#a7c7d8",
    selection: "#dcc19b30",
    lineHighlight: "#ffffff06",
    shadow: "#00000099",
    syntax: {
        keyword: "#d9a7c7",
        string: "#b9d396",
        number: "#e9b77c",
        comment: "#6e6762",
        type: "#a7c7d8",
        func: "#dcc19b",
        regexp: "#e9b77c",
        delimiter: "#9c948d",
        constant: "#e9b77c",
    },
};

const light: Palette = {
    canvas: "#efebe4",
    glowA: "#d9c7ad",
    glowB: "#d8d0dc",
    bg: "#fbf9f5",
    surface: "#fdfbf8",
    surface2: "#f3efe8",
    surface3: "#e9e3d9",
    editor: "#fffdf9",
    border: "#e6e0d6",
    borderStrong: "#d5ccbe",
    text: "#2a231d",
    muted: "#6d645b",
    faint: "#a39a8f",
    accent: "#9c7442",
    accent2: "#86612f",
    accentText: "#fffdf9",
    star: "#b8894c",
    success: "#4c8a3a",
    warning: "#a8670d",
    error: "#c24a3d",
    info: "#3f7690",
    selection: "#9c744226",
    lineHighlight: "#2a231d08",
    shadow: "#2a231d22",
    syntax: {
        keyword: "#9a4a7d",
        string: "#4f7d2e",
        number: "#b0601c",
        comment: "#a39a8f",
        type: "#3f7690",
        func: "#86612f",
        regexp: "#b0601c",
        delimiter: "#6d645b",
        constant: "#b0601c",
    },
};

export const palettes: Record<ThemeName, Palette> = { dark, light };

export type AccentName = "sand" | "rose" | "sage" | "moon";

/** Accent colors to choose from, all in the app's muted, warm family. Sand is StarLight's own. */
export const ACCENTS: Record<AccentName, { label: string; dark: [string, string]; light: [string, string] }> = {
    sand: { label: "샌드", dark: ["#dcc19b", "#c7a77c"], light: ["#9c7442", "#86612f"] },
    rose: { label: "로즈", dark: ["#e3a79c", "#cf8f84"], light: ["#b05a4c", "#96473a"] },
    sage: { label: "세이지", dark: ["#b3cc9c", "#98b582"], light: ["#557d3e", "#426630"] },
    moon: { label: "문라이트", dark: ["#c9cdd9", "#aeb3c2"], light: ["#5a6178", "#474d63"] },
};

/** The palette of [name] with the chosen accent. */
export function palette(name: ThemeName, accent: AccentName): Palette {
    const base = palettes[name];
    const [main, deep] = ACCENTS[accent][name];
    return {
        ...base,
        accent: main,
        accent2: deep,
        star: main,
        selection: main + (name === "dark" ? "30" : "26"),
        syntax: { ...base.syntax, func: name === "dark" ? main : deep },
    };
}

/** Sets the palette as CSS variables (`--bg`, `--syntax-keyword`, ...). */
export function applyCssVariables(name: ThemeName, palette: Palette): void {
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(palette)) {
        if (typeof value === "string") style.setProperty(`--${kebab(key)}`, value);
    }
    for (const [key, value] of Object.entries(palette.syntax)) style.setProperty(`--syntax-${kebab(key)}`, value);
    document.documentElement.dataset.theme = name;
    document.documentElement.style.colorScheme = name;
}

/** Monaco's theme data for a palette of [name]; `monaco.ts` registers it. */
export function monacoTheme(name: ThemeName, p: Palette) {
    const s = p.syntax;
    const hex = (color: string) => color.replace("#", "");
    return {
        base: (name === "dark" ? "vs-dark" : "vs") as "vs-dark" | "vs",
        inherit: true,
        rules: [
            { token: "", foreground: hex(p.text), background: hex(p.editor) },
            { token: "comment", foreground: hex(s.comment), fontStyle: "italic" },
            { token: "keyword", foreground: hex(s.keyword) },
            { token: "string", foreground: hex(s.string) },
            { token: "string.escape", foreground: hex(s.regexp) },
            { token: "number", foreground: hex(s.number) },
            { token: "regexp", foreground: hex(s.regexp) },
            { token: "type", foreground: hex(s.type) },
            { token: "type.identifier", foreground: hex(s.type) },
            { token: "identifier", foreground: hex(p.text) },
            { token: "delimiter", foreground: hex(s.delimiter) },
            { token: "delimiter.bracket", foreground: hex(s.delimiter) },
            { token: "operator", foreground: hex(s.delimiter) },
            { token: "constant", foreground: hex(s.constant) },
            { token: "key", foreground: hex(s.func) },
            { token: "string.key.json", foreground: hex(s.func) },
            { token: "string.value.json", foreground: hex(s.string) },
            { token: "keyword.json", foreground: hex(s.constant) },
        ],
        colors: {
            // The editor
            "editor.background": p.editor,
            "editor.foreground": p.text,
            "editorCursor.foreground": p.star,
            "editor.selectionBackground": p.selection,
            "editor.inactiveSelectionBackground": p.selection,
            "editor.selectionHighlightBackground": p.selection,
            "editor.wordHighlightBackground": p.selection,
            "editor.wordHighlightStrongBackground": p.selection,
            "editor.findMatchBackground": p.star + "55",
            "editor.findMatchHighlightBackground": p.star + "26",
            "editor.lineHighlightBackground": p.lineHighlight,
            "editor.lineHighlightBorder": "#00000000",
            "editorLineNumber.foreground": p.faint,
            "editorLineNumber.activeForeground": p.muted,
            "editorIndentGuide.background1": p.border,
            "editorIndentGuide.activeBackground1": p.faint,
            "editorWhitespace.foreground": p.border,
            "editorRuler.foreground": p.border,
            "editorBracketMatch.background": p.selection,
            "editorBracketMatch.border": p.accent + "80",
            "editorBracketHighlight.foreground1": p.syntax.func,
            "editorBracketHighlight.foreground2": p.syntax.keyword,
            "editorBracketHighlight.foreground3": p.syntax.type,
            "editorBracketHighlight.foreground4": p.syntax.func,
            "editorBracketHighlight.foreground5": p.syntax.keyword,
            "editorBracketHighlight.foreground6": p.syntax.type,
            "editorGutter.background": p.editor,
            "editorError.foreground": p.error,
            "editorWarning.foreground": p.warning,
            "editorInfo.foreground": p.info,
            "editorLink.activeForeground": p.accent,
            "editorStickyScroll.background": p.editor,
            "editorStickyScrollHover.background": p.surface2,
            "editorOverviewRuler.border": "#00000000",
            "editorOverviewRuler.errorForeground": p.error,
            "editorOverviewRuler.warningForeground": p.warning,
            "minimap.background": p.editor,
            "minimap.selectionHighlight": p.selection,
            // Widgets: suggest, hover, find, parameter hints, peek
            "editorWidget.background": p.surface,
            "editorWidget.foreground": p.text,
            "editorWidget.border": p.border,
            "editorSuggestWidget.background": p.surface,
            "editorSuggestWidget.border": p.border,
            "editorSuggestWidget.foreground": p.text,
            "editorSuggestWidget.selectedBackground": p.surface3,
            "editorSuggestWidget.selectedForeground": p.text,
            "editorSuggestWidget.highlightForeground": p.accent,
            "editorSuggestWidget.focusHighlightForeground": p.accent,
            "editorHoverWidget.background": p.surface,
            "editorHoverWidget.border": p.border,
            "editorHoverWidget.foreground": p.text,
            "editorMarkerNavigation.background": p.surface,
            "peekView.border": p.accent,
            "peekViewEditor.background": p.surface,
            "peekViewResult.background": p.surface,
            "peekViewTitle.background": p.surface2,
            "peekViewResult.selectionBackground": p.surface3,
            "peekViewEditor.matchHighlightBackground": p.star + "40",
            "peekViewResult.matchHighlightBackground": p.star + "40",
            "debugExceptionWidget.background": p.surface,
            // Lists and inputs inside widgets and the command palette
            "list.hoverBackground": p.surface2,
            "list.activeSelectionBackground": p.surface3,
            "list.activeSelectionForeground": p.text,
            "list.inactiveSelectionBackground": p.surface2,
            "list.focusBackground": p.surface3,
            "list.highlightForeground": p.accent,
            "list.focusHighlightForeground": p.accent,
            "quickInput.background": p.surface,
            "quickInput.foreground": p.text,
            "quickInputList.focusBackground": p.surface3,
            "quickInputTitle.background": p.surface2,
            "pickerGroup.foreground": p.accent,
            "pickerGroup.border": p.border,
            "input.background": p.surface2,
            "input.foreground": p.text,
            "input.border": p.border,
            "input.placeholderForeground": p.faint,
            "inputOption.activeBorder": p.accent,
            "inputOption.activeBackground": p.accent + "33",
            "inputValidation.errorBackground": p.surface,
            "inputValidation.errorBorder": p.error,
            "focusBorder": p.accent + "99",
            "widget.shadow": p.shadow,
            "menu.background": p.surface,
            "menu.foreground": p.text,
            "menu.selectionBackground": p.surface3,
            "menu.selectionForeground": p.text,
            "menu.separatorBackground": p.border,
            "menu.border": p.border,
            "keybindingLabel.background": p.surface2,
            "keybindingLabel.foreground": p.muted,
            "keybindingLabel.border": p.border,
            "keybindingLabel.bottomBorder": p.border,
            // Scrollbars
            "scrollbar.shadow": "#00000000",
            "scrollbarSlider.background": p.faint + "40",
            "scrollbarSlider.hoverBackground": p.faint + "70",
            "scrollbarSlider.activeBackground": p.faint + "90",
            // Diff editor (conflicts)
            "diffEditor.insertedTextBackground": p.success + "26",
            "diffEditor.removedTextBackground": p.error + "26",
            "diffEditor.insertedLineBackground": p.success + "14",
            "diffEditor.removedLineBackground": p.error + "14",
            "diffEditor.border": p.border,
        },
    };
}

export function systemTheme(): ThemeName {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function kebab(key: string): string {
    return key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
}

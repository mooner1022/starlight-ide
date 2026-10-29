// One palette for the whole IDE: the page reads it as CSS variables and Monaco gets a theme built from the same values,
// so the editor, its widgets (suggest, hover, find) and the panels around it match.

export type ThemeName = "dark" | "light";

interface Palette {
    /** Page background, behind the panels. */
    bg: string;
    /** Sidebars and panels. */
    surface: string;
    /** Raised elements: tabs, inputs, hovered rows. */
    surface2: string;
    /** Selected rows, pressed buttons. */
    surface3: string;
    editor: string;
    border: string;
    text: string;
    muted: string;
    faint: string;
    accent: string;
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

const dark: Palette = {
    bg: "#0c0e14",
    surface: "#12151e",
    surface2: "#191d29",
    surface3: "#222838",
    editor: "#0f121a",
    border: "#232938",
    text: "#d6dbe7",
    muted: "#8d95a8",
    faint: "#5a6175",
    accent: "#8aa4ff",
    accentText: "#0c0e14",
    star: "#f5c66b",
    success: "#8fd18a",
    warning: "#f0b86e",
    error: "#f7768e",
    info: "#7fd1e6",
    selection: "#8aa4ff33",
    lineHighlight: "#ffffff08",
    shadow: "#00000080",
    syntax: {
        keyword: "#c79bf2",
        string: "#a6d68a",
        number: "#f5a97f",
        comment: "#5f6780",
        type: "#7fd1e6",
        func: "#8aa4ff",
        regexp: "#f5c66b",
        delimiter: "#8d95a8",
        constant: "#f5a97f",
    },
};

const light: Palette = {
    bg: "#eef0f5",
    surface: "#f6f7fa",
    surface2: "#eceef4",
    surface3: "#e0e4ee",
    editor: "#ffffff",
    border: "#dde1ea",
    text: "#1e2230",
    muted: "#5b6275",
    faint: "#9097a8",
    accent: "#4a63e7",
    accentText: "#ffffff",
    star: "#c98a12",
    success: "#2f8f46",
    warning: "#b26b00",
    error: "#d13b5a",
    info: "#0f7f99",
    selection: "#4a63e72e",
    lineHighlight: "#1e22300a",
    shadow: "#1e223026",
    syntax: {
        keyword: "#8a3fd1",
        string: "#3f8f3f",
        number: "#c4561d",
        comment: "#8a90a2",
        type: "#0f7f99",
        func: "#3550d6",
        regexp: "#b07a00",
        delimiter: "#5b6275",
        constant: "#c4561d",
    },
};

export const palettes: Record<ThemeName, Palette> = { dark, light };

/** Sets the palette as CSS variables (`--bg`, `--syntax-keyword`, ...). */
export function applyCssVariables(name: ThemeName): void {
    const palette = palettes[name];
    const style = document.documentElement.style;
    for (const [key, value] of Object.entries(palette)) {
        if (typeof value === "string") style.setProperty(`--${kebab(key)}`, value);
    }
    for (const [key, value] of Object.entries(palette.syntax)) style.setProperty(`--syntax-${kebab(key)}`, value);
    document.documentElement.dataset.theme = name;
    document.documentElement.style.colorScheme = name;
}

/** Monaco's theme data for the palette; `monaco.ts` registers it as `starlight-dark` / `starlight-light`. */
export function monacoTheme(name: ThemeName) {
    const p = palettes[name];
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

export function preferredTheme(): ThemeName {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function kebab(key: string): string {
    return key.replace(/[A-Z0-9]/g, (c) => "-" + c.toLowerCase());
}

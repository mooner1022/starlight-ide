// Monaco with only what the IDE uses. Importing `editor.api` instead of `editor.main` leaves out every contribution and
// language; the ones below are added back one by one (the full list is in monaco-editor/esm/vs/editor/editor.all.js).

import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";

// Editing
import "monaco-editor/esm/vs/editor/browser/coreCommands.js";
import "monaco-editor/esm/vs/editor/browser/widget/codeEditor/codeEditorWidget.js";
import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/esm/vs/editor/contrib/comment/browser/comment.js";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/esm/vs/editor/contrib/cursorUndo/browser/cursorUndo.js";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/fontZoom/browser/fontZoom.js";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js";
import "monaco-editor/esm/vs/editor/contrib/indentation/browser/indentation.js";
import "monaco-editor/esm/vs/editor/contrib/lineSelection/browser/lineSelection.js";
import "monaco-editor/esm/vs/editor/contrib/linesOperations/browser/linesOperations.js";
import "monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js";
import "monaco-editor/esm/vs/editor/contrib/smartSelect/browser/smartSelect.js";
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/esm/vs/editor/contrib/stickyScroll/browser/stickyScrollContribution.js";
import "monaco-editor/esm/vs/editor/contrib/tokenization/browser/tokenization.js";
import "monaco-editor/esm/vs/editor/contrib/toggleTabFocusMode/browser/toggleTabFocusMode.js";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js";
import "monaco-editor/esm/vs/editor/contrib/wordOperations/browser/wordOperations.js";
import "monaco-editor/esm/vs/editor/contrib/wordPartOperations/browser/wordPartOperations.js";
// Language features (served by the TypeScript worker)
import "monaco-editor/esm/vs/editor/contrib/codeAction/browser/codeActionContributions.js";
import "monaco-editor/esm/vs/editor/contrib/documentSymbols/browser/documentSymbols.js";
import "monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError.js";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js";
import "monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsContribution.js";
import "monaco-editor/esm/vs/editor/contrib/parameterHints/browser/parameterHints.js";
import "monaco-editor/esm/vs/editor/contrib/rename/browser/rename.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js";
// Conflicts are shown in a diff editor.
import "monaco-editor/esm/vs/editor/browser/widget/diffEditor/diffEditor.contribution.js";
// Command palette (F1), go to line (Ctrl+G), go to symbol (Ctrl+Shift+O), references
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoLineQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneGotoSymbolQuickAccess.js";
import "monaco-editor/esm/vs/editor/standalone/browser/referenceSearch/standaloneReferenceSearch.js";

// Languages: scripts, their JSON config, notes
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/language/typescript/monaco.contribution.js";
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";

import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker";
import { monacoTheme, palettes, type ThemeName } from "./theme";
import neonGlobals from "../libs/neon-globals.d.ts?raw";

self.MonacoEnvironment = {
    // The TypeScript and JSON workers load only when a file of theirs opens.
    async getWorker(_: string, label: string) {
        switch (label) {
            case "typescript":
            case "javascript": {
                const { default: TsWorker } = await import("monaco-editor/esm/vs/language/typescript/ts.worker.js?worker");
                return new TsWorker();
            }
            case "json": {
                const { default: JsonWorker } = await import("monaco-editor/esm/vs/language/json/json.worker.js?worker");
                return new JsonWorker();
            }
            default:
                return new EditorWorker();
        }
    },
};

monaco.editor.defineTheme("starlight-dark", monacoTheme("dark") as monaco.editor.IStandaloneThemeData);
monaco.editor.defineTheme("starlight-light", monacoTheme("light") as monaco.editor.IStandaloneThemeData);

const ts = monaco.languages.typescript;
const compilerOptions: monaco.languages.typescript.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    allowJs: true,
    checkJs: false,
    allowNonTsExtensions: true,
    // Scripts don't run in a browser: no DOM, only the globals of neon-globals.d.ts and StarLight's.
    lib: ["es2020"],
};
ts.javascriptDefaults.setCompilerOptions(compilerOptions);
ts.typescriptDefaults.setCompilerOptions(compilerOptions);
ts.javascriptDefaults.setInlayHintsOptions({ includeInlayParameterNameHints: "literals" });
ts.javascriptDefaults.setEagerModelSync(true);
ts.javascriptDefaults.addExtraLib(neonGlobals, "file:///starlight/neon-globals.d.ts");

let starlightLib: monaco.IDisposable | undefined;

/** Declarations of StarLight's API from the backend's `/api/types`. */
export function setStarlightTypes(declarations: string): void {
    starlightLib?.dispose();
    const lib = ts.javascriptDefaults.addExtraLib(declarations, "file:///starlight/starlight.d.ts");
    const tsLib = ts.typescriptDefaults.addExtraLib(declarations, "file:///starlight/starlight.d.ts");
    starlightLib = { dispose: () => { lib.dispose(); tsLib.dispose(); } };
}

export function setMonacoTheme(name: ThemeName): void {
    monaco.editor.setTheme(`starlight-${name}`);
}

export const editorFont = {
    fontFamily: "'JetBrains Mono', 'D2Coding', 'Cascadia Code', 'Fira Code', Consolas, monospace",
    fontSize: 13.5,
    lineHeight: 21,
};

export { monaco, palettes };

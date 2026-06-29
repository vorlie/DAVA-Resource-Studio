import { useEffect, useRef } from "react";
import { EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, GutterMarker, gutter, keymap, lineNumbers, MatchDecorator, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { autocompletion, type Completion } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { RevealTarget, SymbolOccurrence } from "../workspace";

type CodeEditorProps = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onStage: () => void;
  diagnostics?: Array<{ severity: string; message: string; line: number; column: number }>;
  completions?: string[];
  onOpenInclude?: (target: string) => void;
  navigationSymbol?: string | null;
  navigationOccurrences?: SymbolOccurrence[];
  navigationCurrentIndex?: number;
  onCursorSymbol?: (symbol: string | null) => void;
  onNavigateOccurrence?: (occurrence: SymbolOccurrence) => void;
  onGoToDefinition?: () => void;
  revealTarget?: RevealTarget | null;
  onRevealHandled?: () => void;
};

export type LanguageKind = "yaml" | "json" | "shader" | "plain";

export function languageKindForPath(path: string): LanguageKind {
  if (/\.material$/i.test(path) || /\.ya?ml$/i.test(path)) return "yaml";
  if (/\.json$/i.test(path)) return "json";
  if (/\.(slh|sl)$/i.test(path)) return "shader";
  return "plain";
}

const studioHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "#c792ea" },
  { tag: [tags.typeName, tags.className], color: "#82aaff" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: "#82d2ce" },
  { tag: [tags.string, tags.special(tags.string)], color: "#c3e88d" },
  { tag: [tags.number, tags.bool, tags.null], color: "#f78c6c" },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: "#637777", fontStyle: "italic" },
  { tag: [tags.propertyName, tags.attributeName], color: "#ffcb6b" },
  { tag: [tags.operator, tags.punctuation], color: "#89a4bb" },
  { tag: tags.meta, color: "#f07178" },
  { tag: tags.definition(tags.variableName), color: "#dce4ee" },
]);

const shaderTokenMatcher = new MatchDecorator({
  regexp: /\b(?:uniform|property|fragment_in|fragment_out|vertex_in|vertex_out|sampler2D|samplerCUBE|half[1-4]?|float[1-4](?:x[1-4])?)\b/g,
  decoration: (match) => Decoration.mark({ class: /^(?:half|float|sampler)/.test(match[0]) ? "cm-shader-type" : "cm-shader-keyword" }),
});

const shaderTokens = ViewPlugin.define((view) => ({
  decorations: shaderTokenMatcher.createDeco(view),
  update(update) { this.decorations = shaderTokenMatcher.updateDeco(update, this.decorations); },
}), { decorations: (value) => value.decorations });

type NavigationPayload = { symbol: string | null; occurrences: SymbolOccurrence[]; currentIndex: number };
type NavigationFieldValue = NavigationPayload & { decorations: DecorationSet };
const setSymbolNavigation = StateEffect.define<NavigationPayload>();

function isDeclaration(kind: SymbolOccurrence["kind"]) {
  return kind.endsWith("_declaration") || kind === "macro_definition";
}

function makeNavigationValue(state: EditorState, payload: NavigationPayload): NavigationFieldValue {
  const ranges = payload.occurrences.flatMap((occurrence, index) => {
    if (occurrence.line < 1 || occurrence.line > state.doc.lines) return [];
    const line = state.doc.line(occurrence.line);
    const from = Math.min(line.to, line.from + Math.max(0, occurrence.column - 1));
    const to = Math.min(line.to, from + occurrence.length);
    if (from === to) return [];
    return [Decoration.mark({ class: `${isDeclaration(occurrence.kind) ? "cm-symbol-declaration" : "cm-symbol-usage"}${index === payload.currentIndex ? " current" : ""}` }).range(from, to)];
  });
  return { ...payload, decorations: Decoration.set(ranges, true) };
}

const symbolNavigationField = StateField.define<NavigationFieldValue>({
  create: (state) => makeNavigationValue(state, { symbol: null, occurrences: [], currentIndex: -1 }),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setSymbolNavigation)) return makeNavigationValue(transaction.state, effect.value);
    return transaction.docChanged ? { ...value, decorations: value.decorations.map(transaction.changes) } : value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

class SymbolGutterMarker extends GutterMarker {
  readonly elementClass: string;
  constructor(readonly declaration: boolean, readonly current: boolean) { super(); this.elementClass = `${declaration ? "cm-symbol-gutter-declaration" : "cm-symbol-gutter-usage"}${current ? " current" : ""}`; }
  toDOM() { const node = document.createElement("span"); node.textContent = this.declaration ? "◆" : "•"; node.title = this.declaration ? "Symbol declaration" : "Symbol usage"; return node; }
}

function classifyLocalLine(line: string, symbol: string): SymbolOccurrence["kind"] {
  const trimmed = line.trim();
  if (new RegExp(`^#(?:define|ensuredefined)\\s+${symbol}\\b`).test(trimmed)) return "macro_definition";
  if (/^#(?:if|ifdef|ifndef|elif)\b/.test(trimmed)) return "condition";
  if (trimmed.includes("uniform ") && new RegExp(`\\b${symbol}\\s*(?:;|:)`).test(trimmed)) return "uniform_declaration";
  if (trimmed.includes(" property ") && new RegExp(`\\b${symbol}\\s*(?:;|:)`).test(trimmed)) return "property_declaration";
  if (/^(?:fp_main|vp_main)$/.test(symbol) && new RegExp(`\\b${symbol}\\s*\\(`).test(trimmed)) return "entry_point_declaration";
  return "usage";
}

export function scanLocalSymbolOccurrences(path: string, text: string, symbol: string): SymbolOccurrence[] {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol)) return [];
  const result: SymbolOccurrence[] = [];
  let blockComment = false;
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const bytes = [...line];
    let quote: string | null = null;
    let index = 0;
    while (index < bytes.length) {
      if (blockComment) { if (bytes[index] === "*" && bytes[index + 1] === "/") { blockComment = false; index += 2; } else index += 1; continue; }
      if (quote) { if (bytes[index] === "\\") index += 2; else { if (bytes[index] === quote) quote = null; index += 1; } continue; }
      if (bytes[index] === "/" && bytes[index + 1] === "/") break;
      if (bytes[index] === "/" && bytes[index + 1] === "*") { blockComment = true; index += 2; continue; }
      if (bytes[index] === '"' || bytes[index] === "'") { quote = bytes[index]; index += 1; continue; }
      if (/[A-Za-z_]/.test(bytes[index])) {
        const start = index; index += 1;
        while (index < bytes.length && /[A-Za-z0-9_]/.test(bytes[index])) index += 1;
        if (bytes.slice(start, index).join("") === symbol) result.push({ path, line: lineIndex + 1, column: start + 1, length: symbol.length, kind: classifyLocalLine(line, symbol), preview: line.trim() });
        continue;
      }
      index += 1;
    }
  });
  return result;
}

function languageExtensions(path: string) {
  switch (languageKindForPath(path)) {
    case "yaml": return [yaml()];
    case "json": return [json()];
    case "shader": return [cpp(), shaderTokens];
    default: return [];
  }
}

export default function CodeEditor({ path, value, onChange, onStage, diagnostics = [], completions = [], onOpenInclude, navigationSymbol = null, navigationOccurrences = [], navigationCurrentIndex = -1, onCursorSymbol, onNavigateOccurrence, onGoToDefinition, revealTarget, onRevealHandled }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const stageRef = useRef(onStage);
  const includeRef = useRef(onOpenInclude);
  const completionsRef = useRef(completions);
  const cursorRef = useRef(onCursorSymbol);
  const navigateRef = useRef(onNavigateOccurrence);
  const definitionRef = useRef(onGoToDefinition);
  const cursorTimer = useRef<number | null>(null);

  changeRef.current = onChange;
  stageRef.current = onStage;
  includeRef.current = onOpenInclude;
  completionsRef.current = completions;
  cursorRef.current = onCursorSymbol;
  navigateRef.current = onNavigateOccurrence;
  definitionRef.current = onGoToDefinition;

  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { stageRef.current(); return true; } },
            { key: "F12", preventDefault: true, run: () => { definitionRef.current?.(); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
          ]),
          EditorView.lineWrapping,
          autocompletion({ override: [(context) => {
            const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/);
            if (!word || (!context.explicit && word.from === word.to)) return null;
            const options: Completion[] = completionsRef.current.map((label) => ({ label, type: /^[A-Z0-9_]+$/.test(label) ? "constant" : "keyword" }));
            return { from: word.from, options };
          }] }),
          syntaxHighlighting(studioHighlightStyle, { fallback: true }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) changeRef.current(update.state.doc.toString());
            if ((update.selectionSet || update.docChanged) && languageKindForPath(path) === "shader") {
              if (cursorTimer.current !== null) window.clearTimeout(cursorTimer.current);
              cursorTimer.current = window.setTimeout(() => {
                const position = update.state.selection.main.head;
                const line = update.state.doc.lineAt(position);
                const offset = position - line.from;
                const left = line.text.slice(0, offset).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
                const right = line.text.slice(offset).match(/^[A-Za-z0-9_]*/)?.[0] ?? "";
                const symbol = `${left}${right}`;
                cursorRef.current?.(/^[A-Za-z_][A-Za-z0-9_]*$/.test(symbol) ? symbol : null);
              }, 150);
            }
          }),
          EditorView.domEventHandlers({
            mousedown(event, view) {
              if (!(event.ctrlKey || event.metaKey) || !includeRef.current) return false;
              const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
              if (position === null) return false;
              const line = view.state.doc.lineAt(position).text;
              const target = line.match(/^\s*#include\s+["<]([^">]+)[">]/)?.[1];
              if (!target) return false;
              event.preventDefault();
              includeRef.current(target);
              return true;
            },
          }),
          EditorView.theme({
            "&": { height: "100%", backgroundColor: "#0b1017", color: "#cbd5e1" },
            ".cm-content": { caretColor: "#54a7ff", fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace", fontSize: "13px" },
            ".cm-gutters": { backgroundColor: "#0e151e", color: "#536174", border: "none" },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "rgba(84,167,255,.06)" },
            ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(84,167,255,.24)" },
            "&.cm-focused": { outline: "none" },
            ".cm-shader-keyword": { color: "#c792ea", fontWeight: "600" },
            ".cm-shader-type": { color: "#82aaff" },
            ".cm-symbol-declaration": { backgroundColor: "rgba(84,167,255,.22)", borderBottom: "1px solid #54a7ff" },
            ".cm-symbol-usage": { backgroundColor: "rgba(244,193,93,.14)", borderBottom: "1px solid rgba(244,193,93,.75)" },
            ".cm-symbol-declaration.current, .cm-symbol-usage.current": { backgroundColor: "rgba(255,107,122,.28)", outline: "1px solid rgba(255,107,122,.8)" },
          }),
          symbolNavigationField,
          gutter({
            class: "cm-symbol-gutter",
            lineMarker(view, line) {
              const navigation = view.state.field(symbolNavigationField);
              const lineNumber = view.state.doc.lineAt(line.from).number;
              const index = navigation.occurrences.findIndex((item) => item.line === lineNumber);
              if (index < 0) return null;
              return new SymbolGutterMarker(isDeclaration(navigation.occurrences[index].kind), index === navigation.currentIndex);
            },
            domEventHandlers: { mousedown(view, line) { const lineNumber = view.state.doc.lineAt(line.from).number; const occurrence = view.state.field(symbolNavigationField).occurrences.find((item) => item.line === lineNumber); if (occurrence) navigateRef.current?.(occurrence); return Boolean(occurrence); } },
          }),
          ...languageExtensions(path),
        ],
      }),
    });
    viewRef.current = view;
    return () => { if (cursorTimer.current !== null) window.clearTimeout(cursorTimer.current); viewRef.current = null; view.destroy(); };
  }, [path]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const mapped: Diagnostic[] = diagnostics.map((item) => {
      const lineNumber = Math.min(Math.max(item.line, 1), view.state.doc.lines);
      const line = view.state.doc.line(lineNumber);
      const from = Math.min(line.to, line.from + Math.max(item.column - 1, 0));
      return { from, to: Math.min(line.to, from + 1), severity: item.severity === "warning" ? "warning" : "error", message: item.message };
    });
    view.dispatch(setDiagnostics(view.state, mapped));
  }, [diagnostics]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const local = navigationSymbol ? scanLocalSymbolOccurrences(path, value, navigationSymbol) : [];
    const current = navigationOccurrences[navigationCurrentIndex];
    const currentLocalIndex = current?.path === path ? local.findIndex((item) => item.line === current.line && item.column === current.column) : -1;
    view.dispatch({ effects: setSymbolNavigation.of({ symbol: navigationSymbol, occurrences: local, currentIndex: currentLocalIndex }) });
  }, [navigationCurrentIndex, navigationOccurrences, navigationSymbol, path, value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !revealTarget || revealTarget.path !== path || revealTarget.line < 1 || revealTarget.line > view.state.doc.lines) return;
    const line = view.state.doc.line(revealTarget.line);
    const anchor = Math.min(line.to, line.from + Math.max(0, revealTarget.column - 1));
    view.dispatch({ selection: { anchor, head: Math.min(line.to, anchor + revealTarget.length) }, effects: EditorView.scrollIntoView(anchor, { y: "center" }) });
    view.focus();
    onRevealHandled?.();
  }, [onRevealHandled, path, revealTarget]);

  return <div className="code-editor" ref={host} />;
}

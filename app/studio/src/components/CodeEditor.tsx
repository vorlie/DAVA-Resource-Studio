import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { Decoration, EditorView, keymap, lineNumbers, MatchDecorator, ViewPlugin } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import { yaml } from "@codemirror/lang-yaml";
import { json } from "@codemirror/lang-json";
import { cpp } from "@codemirror/lang-cpp";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { autocompletion, type Completion } from "@codemirror/autocomplete";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";

type CodeEditorProps = {
  path: string;
  value: string;
  onChange: (value: string) => void;
  onStage: () => void;
  diagnostics?: Array<{ severity: string; message: string; line: number; column: number }>;
  completions?: string[];
  onOpenInclude?: (target: string) => void;
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

function languageExtensions(path: string) {
  switch (languageKindForPath(path)) {
    case "yaml": return [yaml()];
    case "json": return [json()];
    case "shader": return [cpp(), shaderTokens];
    default: return [];
  }
}

export default function CodeEditor({ path, value, onChange, onStage, diagnostics = [], completions = [], onOpenInclude }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  const stageRef = useRef(onStage);
  const includeRef = useRef(onOpenInclude);
  const completionsRef = useRef(completions);

  changeRef.current = onChange;
  stageRef.current = onStage;
  includeRef.current = onOpenInclude;
  completionsRef.current = completions;

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
          }),
          ...languageExtensions(path),
        ],
      }),
    });
    viewRef.current = view;
    return () => { viewRef.current = null; view.destroy(); };
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

  return <div className="code-editor" ref={host} />;
}

import { memo } from "react";
import type { OpenTab } from "../workspace";
import CodeEditor from "./CodeEditor";

type EditorProps = {
  tabs: OpenTab[];
  activePath: string | null;
  onActivate: (path: string) => void;
  onClose: (path: string) => void;
  onEdit: (path: string, value: string) => void;
  onStage: (path: string) => void;
  onApplyAll: () => void;
  onDiscardActive: () => void;
  onDiscardAll: () => void;
  hasUnsavedWork: boolean;
  diagnostics: Array<{ severity: string; message: string; line: number; column: number }>;
  materialSummary: MaterialSummary | null;
  shaderInfo: ShaderFileInfo | null;
  shaderCompletions: string[];
  onFormat: () => void;
  onOpenInclude: (target: string) => void;
  referencePaths: string[];
  onFindReferences: (symbol: string) => void;
};

export type MaterialSummary = { shader: string | null; layers: string[]; unique_defines: string[]; ignore_defines: string[]; render_state: Record<string, unknown>; passes: string[]; presets: string[] };
export type ShaderFileInfo = { path: string; includes: string[]; missing_includes: string[]; defines: string[]; conditions: string[]; properties: string[]; uniforms: string[]; entry_points: string[] };

const fileName = (path: string) => path.split("/").pop() ?? path;

function Editor({ tabs, activePath, onActivate, onClose, onEdit, onStage, onApplyAll, onDiscardActive, onDiscardAll, hasUnsavedWork, diagnostics, materialSummary, shaderInfo, shaderCompletions, onFormat, onOpenInclude, referencePaths, onFindReferences }: EditorProps) {
  const active = tabs.find((tab) => tab.path === activePath) ?? null;

  return (
    <main className="editor">
      <div className="tabbar" role="tablist" aria-label="Open files">
        {tabs.map((tab) => (
          <div key={tab.path} className={`tab${tab.path === activePath ? " active" : ""}`} role="tab" aria-selected={tab.path === activePath}>
            <button className="tab-select" title={tab.path} onClick={() => onActivate(tab.path)}>
              <span className={`tab-dot ${tab.status}`} />
              <span>{fileName(tab.path)}</span>
            </button>
            <button className="tab-close" aria-label={`Close ${fileName(tab.path)}`} onClick={() => onClose(tab.path)}>×</button>
          </div>
        ))}
      </div>

      <div className="editor-toolbar">
        <div className="editor-title" title={active?.path}>{active?.path ?? "No file selected"}</div>
        <div className="editor-actions">
          <button className="ghost" onClick={onDiscardActive} disabled={!active || !["draft", "staged"].includes(active.status)}>Revert</button>
          <button className="ghost" onClick={onDiscardAll} disabled={!hasUnsavedWork}>Discard all</button>
          <button className="ghost" onClick={onFormat} disabled={!active || !/\.(ya?ml|json|material)$/i.test(active.path)}>Format</button>
          <button className="ghost" onClick={() => active && onStage(active.path)} disabled={!active || active.status !== "draft"}>Stage</button>
          <button className="primary" onClick={onApplyAll} disabled={!tabs.some((tab) => tab.status === "draft" || tab.status === "staged")}>Apply all</button>
        </div>
      </div>

      <div className="editor-body">
        {!active && <div className="editor-empty"><strong>Open a resource to begin</strong><span>Use the Data tree or press Ctrl+P to search.</span></div>}
        {active?.status === "loading" && <div className="editor-empty">Loading {active.path}…</div>}
        {active?.status === "binary" && <div className="editor-empty"><strong>Binary resource</strong><span>{active.binarySize?.toLocaleString()} bytes · read-only preview is not available yet.</span></div>}
        {active?.status === "error" && <div className="editor-empty error"><strong>Could not open resource</strong><span>{active.error}</span></div>}
        {active && ["clean", "draft", "staged"].includes(active.status) && <div className={`editor-content${materialSummary || shaderInfo || diagnostics.length ? " with-inspector" : ""}`}>
          <CodeEditor path={active.path} value={active.draft} onChange={(value) => onEdit(active.path, value)} onStage={() => onStage(active.path)} diagnostics={diagnostics} completions={shaderCompletions} onOpenInclude={onOpenInclude} />
          {(materialSummary || shaderInfo || diagnostics.length > 0) && <aside className="resource-inspector">
            {diagnostics.length > 0 && <section><h3>Diagnostics</h3>{diagnostics.map((item, index) => <div className="diagnostic" key={`${item.line}-${index}`}>L{item.line}:{item.column} {item.message}</div>)}</section>}
            {materialSummary && <><section><h3>Material</h3><InspectorRow label="Shader" values={materialSummary.shader ? [materialSummary.shader] : []} /><InspectorRow label="Layers" values={materialSummary.layers} /><InspectorRow label="Defines" values={materialSummary.unique_defines} /><InspectorRow label="Ignored" values={materialSummary.ignore_defines} /><InspectorRow label="Render state" values={Object.entries(materialSummary.render_state).map(([key, value]) => `${key}: ${String(value)}`)} /></section><section><h3>Passes</h3><div>{materialSummary.passes.join(", ") || "None"}</div><h3>Presets</h3><div>{materialSummary.presets.join(", ") || "None"}</div></section></>}
            {shaderInfo && <section><h3>Shader structure</h3><InspectorRow label="Includes" values={shaderInfo.includes} /><InspectorRow label="Missing" values={shaderInfo.missing_includes} /><InspectorRow label="Defines (click for references)" values={shaderInfo.defines} onSelect={onFindReferences} /><InspectorRow label="Conditions" values={shaderInfo.conditions} onSelect={onFindReferences} /><InspectorRow label="Properties" values={shaderInfo.properties} onSelect={onFindReferences} /><InspectorRow label="Uniforms" values={shaderInfo.uniforms} onSelect={onFindReferences} /><InspectorRow label="Entries" values={shaderInfo.entry_points} />{referencePaths.length > 0 && <InspectorRow label="References" values={referencePaths} />}</section>}
          </aside>}
        </div>}
      </div>
    </main>
  );
}

function InspectorRow({ label, values, onSelect }: { label: string; values: string[]; onSelect?: (value: string) => void }) {
  return <div className="inspector-row"><span>{label}</span><div>{values.length ? values.map((value) => onSelect ? <button className="inspector-link" key={value} onClick={() => onSelect(value)}>{value}</button> : <code key={value}>{value}</code>) : "—"}</div></div>;
}

export default memo(Editor);

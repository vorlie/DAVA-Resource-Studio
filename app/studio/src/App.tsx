import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import "./App.css";
import Sidebar from "./components/Sidebar";
import FileTree from "./components/FileTree";
import Editor from "./components/Editor";
import StatusBar from "./components/StatusBar";
import GraphicsView from "./components/GraphicsView";
import ShaderCacheView from "./components/ShaderCacheView";
import PlaygroundView from "./components/PlaygroundView";
import type { MaterialSummary, ShaderFileInfo } from "./components/Editor";
import { scanLocalSymbolOccurrences } from "./components/CodeEditor";
import { DEFAULT_LAYOUT, hasUnsavedWork, initialWorkspace, workspaceReducer, type OpenTab, type PanelLayout, type PendingNavigation, type SymbolMap, type SymbolOccurrence } from "./workspace";

export interface VfsEntry { path: string; is_dvpl: boolean; size: number; }
export interface GameInstall { edition: string; path: string; version: string | null; }
export type ActiveView = "files" | "graphics" | "playground" | "cache" | "settings";
type Diagnostic = { severity: string; message: string; line: number; column: number };
type ShaderIndex = { files: ShaderFileInfo[]; macros: string[]; cycles: string[][] };

const LAYOUT_KEY = "dava-resource-studio.layout.v1";
const TREE_KEY = "dava-resource-studio.expanded.v1";
const normalizePath = (path: string) => path.replace(/\\/g, "/");

function readLayout(): PanelLayout {
  try { return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") }; }
  catch { return DEFAULT_LAYOUT; }
}

function readExpanded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(TREE_KEY) ?? '[""]')); }
  catch { return new Set([""]); }
}

function App() {
  const [workspace, dispatch] = useReducer(workspaceReducer, undefined, () => initialWorkspace(readLayout()));
  const [activeView, setActiveView] = useState<ActiveView>("files");
  const [gameInstall, setGameInstall] = useState<GameInstall | null>(null);
  const [entries, setEntries] = useState<VfsEntry[]>([]);
  const [expanded, setExpanded] = useState(readExpanded);
  const [status, setStatus] = useState("Detecting game…");
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [materialSummary, setMaterialSummary] = useState<MaterialSummary | null>(null);
  const [shaderIndex, setShaderIndex] = useState<ShaderIndex>({ files: [], macros: [], cycles: [] });
  const [gameRunning, setGameRunning] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);
  const symbolRequestId = useRef(0);
  const revealRequestId = useRef(0);
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const activeTab = useMemo(() => workspace.tabs.find((tab) => tab.path === workspace.activePath) ?? null, [workspace.activePath, workspace.tabs]);
  const activeShader = useMemo(() => shaderIndex.files.find((file) => file.path === activeTab?.path) ?? null, [activeTab?.path, shaderIndex.files]);
  const navigableSymbols = useMemo(() => new Set(shaderIndex.files.flatMap((file) => [...file.defines, ...file.conditions, ...file.properties, ...file.uniforms, ...file.entry_points])), [shaderIndex.files]);

  useEffect(() => { localStorage.setItem(LAYOUT_KEY, JSON.stringify(workspace.layout)); }, [workspace.layout]);
  useEffect(() => { localStorage.setItem(TREE_KEY, JSON.stringify([...expanded])); }, [expanded]);

  const refreshStaged = useCallback(async () => {
    const paths = await invoke<string[]>("vfs_dirty_paths");
    dispatch({ type: "SET_STAGED_PATHS", paths });
  }, []);

  const performOpenGame = useCallback(async (dir: string, install?: GameInstall) => {
    try {
      let resolved = install;
      if (!resolved) {
        resolved = await invoke<GameInstall | null>("game_probe", { path: dir }) ?? undefined;
        if (!resolved) { setStatus(`Not a valid game directory: ${dir}`); return; }
      }
      await invoke("vfs_open", { root: dir });
      const list = await invoke<VfsEntry[]>("vfs_list");
      setEntries(list.map((entry) => ({ ...entry, path: normalizePath(entry.path) })));
      setGameInstall(resolved);
      try { setShaderIndex(await invoke<ShaderIndex>("shader_index")); } catch { setShaderIndex({ files: [], macros: [], cycles: [] }); }
      dispatch({ type: "CLOSE_ALL" });
      setStatus(`Opened ${dir}`);
    } catch (error) { setStatus(`Could not open game: ${error}`); }
  }, []);

  const requestNavigation = useCallback((pending: Exclude<PendingNavigation, null>) => {
    if (hasUnsavedWork(workspaceRef.current)) dispatch({ type: "SET_PENDING_NAVIGATION", pending });
    else if (pending.kind === "open-game") void performOpenGame(pending.path, pending.install);
    else if (pending.kind === "exit") void getCurrentWindow().destroy();
  }, [performOpenGame]);

  const refreshProcess = useCallback(async () => {
    try { setGameRunning((await invoke<{ running: boolean }>("game_process_status")).running); } catch { setGameRunning(false); }
  }, []);
  useEffect(() => { void refreshProcess(); const timer = window.setInterval(() => void refreshProcess(), 3000); return () => window.clearInterval(timer); }, [refreshProcess]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!activeTab || !["clean", "draft", "staged"].includes(activeTab.status)) { setDiagnostics([]); setMaterialSummary(null); return; }
      const extension = activeTab.path.split(".").pop()?.toLowerCase();
      const kind = extension === "material" ? "material" : extension === "json" ? "json" : extension === "yaml" || extension === "yml" ? "yaml" : "plain";
      void invoke<Diagnostic[]>("resource_validate", { kind, text: activeTab.draft }).then((items) => { if (!cancelled) setDiagnostics(items); });
      if (kind === "material") void invoke<MaterialSummary>("material_inspect", { text: activeTab.draft }).then((summary) => { if (!cancelled) setMaterialSummary(summary); }).catch(() => { if (!cancelled) setMaterialSummary(null); });
      else setMaterialSummary(null);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeTab]);

  useEffect(() => {
    void (async () => {
      try {
        const installs = await invoke<GameInstall[]>("game_detect");
        if (installs[0]) await performOpenGame(installs[0].path, installs[0]);
        else setStatus("No game detected. Open a folder manually.");
      } catch (error) { setStatus(`Game detection failed: ${error}`); }
    })();
  }, [performOpenGame]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void getCurrentWindow().onCloseRequested((event) => {
      if (hasUnsavedWork(workspaceRef.current)) {
        event.preventDefault();
        dispatch({ type: "SET_PENDING_NAVIGATION", pending: { kind: "exit" } });
      }
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, []);

  const browse = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir === "string") requestNavigation({ kind: "open-game", path: dir });
  }, [requestNavigation]);

  const selectFile = useCallback(async (rawPath: string) => {
    const path = normalizePath(rawPath);
    const existing = workspaceRef.current.tabs.find((tab) => tab.path === path);
    if (existing) { dispatch({ type: "ACTIVATE_TAB", path }); return; }
    const id = ++requestId.current;
    dispatch({ type: "OPEN_TAB", path, requestId: id });
    try {
      const bytes = await invoke<number[]>("vfs_read", { vpath: path });
      try {
        const content = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        dispatch({ type: "LOAD_TEXT", path, requestId: id, content });
      } catch {
        dispatch({ type: "LOAD_BINARY", path, requestId: id, size: bytes.length });
      }
    } catch (error) { dispatch({ type: "LOAD_ERROR", path, requestId: id, error: String(error) }); }
  }, []);

  const requestSymbolMap = useCallback(async (symbol: string, pinned: boolean) => {
    const path = workspaceRef.current.activePath;
    if (!path || !/\.(sl|slh)$/i.test(path)) return;
    const id = ++symbolRequestId.current;
    dispatch({ type: "START_SYMBOL_MAP", symbol, requestId: id, pinned });
    try {
      const map = await invoke<SymbolMap>("shader_symbol_map", { path, symbol });
      const tab = workspaceRef.current.tabs.find((item) => item.path === path);
      if (tab && ["clean", "draft", "staged"].includes(tab.status)) {
        const local = scanLocalSymbolOccurrences(path, tab.draft, symbol);
        map.occurrences = [...local, ...map.occurrences.filter((item) => item.path !== path)];
      }
      dispatch({ type: "SET_SYMBOL_MAP", map, requestId: id });
    } catch (error) {
      dispatch({ type: "SET_SYMBOL_MAP_ERROR", error: String(error), requestId: id });
    }
  }, []);

  const previewSymbol = useCallback((symbol: string | null) => {
    if (workspaceRef.current.symbolNavigation.pinned) return;
    if (!symbol || !navigableSymbols.has(symbol)) { dispatch({ type: "CLEAR_SYMBOL_MAP" }); return; }
    if (workspaceRef.current.symbolNavigation.symbol === symbol && workspaceRef.current.symbolNavigation.map) return;
    void requestSymbolMap(symbol, false);
  }, [navigableSymbols, requestSymbolMap]);

  const pinSymbol = useCallback((symbol: string) => { void requestSymbolMap(symbol, true); }, [requestSymbolMap]);

  const navigateOccurrence = useCallback(async (occurrence: SymbolOccurrence) => {
    const occurrences = workspaceRef.current.symbolNavigation.map?.occurrences ?? [];
    const index = occurrences.findIndex((item) => item.path === occurrence.path && item.line === occurrence.line && item.column === occurrence.column && item.kind === occurrence.kind);
    if (index >= 0) dispatch({ type: "SET_SYMBOL_INDEX", index });
    await selectFile(occurrence.path);
    dispatch({ type: "SET_REVEAL_TARGET", target: { ...occurrence, requestId: ++revealRequestId.current } });
  }, [selectFile]);

  const navigateByOffset = useCallback((offset: number) => {
    const navigation = workspaceRef.current.symbolNavigation;
    const occurrences = navigation.map?.occurrences ?? [];
    if (!occurrences.length) return;
    const index = (Math.max(navigation.currentIndex, 0) + offset + occurrences.length) % occurrences.length;
    void navigateOccurrence(occurrences[index]);
  }, [navigateOccurrence]);

  const goToDefinition = useCallback(() => {
    const occurrence = workspaceRef.current.symbolNavigation.map?.occurrences.find((item) => item.kind.endsWith("_declaration") || item.kind === "macro_definition");
    if (occurrence) void navigateOccurrence(occurrence);
  }, [navigateOccurrence]);

  useEffect(() => {
    const navigation = workspaceRef.current.symbolNavigation;
    if (navigation.pinned && navigation.symbol && activeTab && /\.(sl|slh)$/i.test(activeTab.path)) {
      const remainsInsideMappedScope = navigation.map?.occurrences.some((item) => item.path === activeTab.path);
      if (!remainsInsideMappedScope) void requestSymbolMap(navigation.symbol, true);
    }
    else if (!navigation.pinned) dispatch({ type: "CLEAR_SYMBOL_MAP" });
  }, [activeTab?.path, requestSymbolMap]);

  const stageTab = useCallback(async (path: string) => {
    const tab = workspaceRef.current.tabs.find((item) => item.path === path);
    if (!tab || tab.status !== "draft") return true;
    try {
      await invoke("vfs_write", { vpath: path, data: Array.from(new TextEncoder().encode(tab.draft)) });
      dispatch({ type: "MARK_STAGED", paths: [path] });
      setStatus(`Staged ${path}`);
      return true;
    } catch (error) {
      setStatus(`Could not stage ${path}: ${error}`);
      return false;
    }
  }, []);

  const stageDrafts = useCallback(async (tabs: OpenTab[]) => {
    const drafts = tabs.filter((tab) => tab.status === "draft");
    for (const tab of drafts) await invoke("vfs_write", { vpath: tab.path, data: Array.from(new TextEncoder().encode(tab.draft)) });
    if (drafts.length) dispatch({ type: "MARK_STAGED", paths: drafts.map((tab) => tab.path) });
  }, []);

  const applyAll = useCallback(async () => {
    try {
      if (gameRunning) throw new Error("Close World of Tanks Blitz before applying resources.");
      await stageDrafts(workspaceRef.current.tabs);
      await invoke("vfs_flush");
      dispatch({ type: "MARK_APPLIED" });
      try { setShaderIndex(await invoke<ShaderIndex>("shader_index")); } catch { /* keep the last usable index */ }
      setStatus("Applied all changes to the game.");
      return true;
    } catch (error) { await refreshStaged(); setStatus(`Could not apply changes: ${error}`); return false; }
  }, [gameRunning, refreshStaged, stageDrafts]);

  const formatActive = useCallback(async () => {
    const tab = workspaceRef.current.tabs.find((item) => item.path === workspaceRef.current.activePath);
    if (!tab || !confirm("Formatting can change layout and remove comments. Continue?")) return;
    const extension = tab.path.split(".").pop()?.toLowerCase();
    const kind = extension === "material" ? "material" : extension === "json" ? "json" : "yaml";
    try { const draft = await invoke<string>("resource_format", { kind, text: tab.draft }); dispatch({ type: "EDIT_TAB", path: tab.path, draft }); setStatus(`Formatted ${tab.path}`); }
    catch (error) { setStatus(`Format failed: ${error}`); }
  }, []);

  const openInclude = useCallback((target: string) => {
    const current = shaderIndex.files.find((file) => file.path === workspaceRef.current.activePath);
    const normalized = target.replace(/\\/g, "/");
    const resolved = current?.includes.find((path) => path === normalized || path.endsWith(`/${normalized}`));
    if (resolved) void selectFile(resolved); else setStatus(`Include not found: ${target}`);
  }, [selectFile, shaderIndex.files]);

  const revertActive = useCallback(async () => {
    const tab = workspaceRef.current.tabs.find((item) => item.path === workspaceRef.current.activePath);
    if (!tab) return;
    if (tab.status === "draft") { dispatch({ type: "DISCARD_DRAFT", path: tab.path }); return; }
    if (tab.status === "staged") {
      try {
        await invoke("vfs_discard_path", { vpath: tab.path });
        const bytes = await invoke<number[]>("vfs_read", { vpath: tab.path });
        const content = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        dispatch({ type: "REVERT_TAB", path: tab.path, content });
        setStatus(`Reverted ${tab.path}`);
      } catch (error) { setStatus(`Could not revert ${tab.path}: ${error}`); }
    }
  }, []);

  const discardAll = useCallback(async () => {
    try {
      await invoke("vfs_discard");
      dispatch({ type: "SET_STAGED_PATHS", paths: [] });
      const reloadable = workspaceRef.current.tabs.filter((tab) => ["clean", "draft", "staged"].includes(tab.status));
      for (const tab of reloadable) {
        const bytes = await invoke<number[]>("vfs_read", { vpath: tab.path });
        const content = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
        dispatch({ type: "REVERT_TAB", path: tab.path, content });
      }
      setStatus("Discarded all drafts and staged changes.");
    } catch (error) { setStatus(`Could not discard changes: ${error}`); }
  }, []);

  const closeTab = useCallback((path: string) => {
    const tab = workspaceRef.current.tabs.find((item) => item.path === path);
    if (tab?.status === "draft") dispatch({ type: "SET_PENDING_NAVIGATION", pending: { kind: "close-tab", path } });
    else dispatch({ type: "CLOSE_TAB", path });
  }, []);

  const finishPending = useCallback(async (choice: "save" | "discard" | "cancel") => {
    const pending = workspaceRef.current.pendingNavigation;
    if (!pending || choice === "cancel") { dispatch({ type: "SET_PENDING_NAVIGATION", pending: null }); return; }
    try {
      if (pending.kind === "close-tab") {
        if (choice === "save" && !await stageTab(pending.path)) return;
        dispatch({ type: "CLOSE_TAB", path: pending.path });
      } else {
        if (choice === "save") { await stageDrafts(workspaceRef.current.tabs); await invoke("vfs_flush"); }
        else await invoke("vfs_discard");
        dispatch({ type: "MARK_APPLIED" });
        if (pending.kind === "open-game") await performOpenGame(pending.path, pending.install);
        else await getCurrentWindow().destroy();
      }
      dispatch({ type: "SET_PENDING_NAVIGATION", pending: null });
    } catch (error) { setStatus(`Could not resolve unsaved changes: ${error}`); }
  }, [performOpenGame, stageDrafts, stageTab]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "p") { event.preventDefault(); setActiveView("files"); requestAnimationFrame(() => searchRef.current?.focus()); }
      if (event.key.toLowerCase() === "w" && workspaceRef.current.activePath) { event.preventDefault(); closeTab(workspaceRef.current.activePath); }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (event.shiftKey) void applyAll();
        else if (!(event.target as Element | null)?.closest?.(".cm-editor") && workspaceRef.current.activePath) void stageTab(workspaceRef.current.activePath);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [applyAll, closeTab, stageTab]);

  const startResize = (panel: "navWidth" | "treeWidth", event: React.PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startValue = workspace.layout[panel];
    const move = (moveEvent: PointerEvent) => {
      const max = panel === "navWidth" ? 320 : Math.max(260, window.innerWidth - (workspace.layout.navCollapsed ? 56 : workspace.layout.navWidth) - 360);
      const min = panel === "navWidth" ? 160 : 240;
      dispatch({ type: "SET_LAYOUT", layout: { [panel]: Math.min(max, Math.max(min, startValue + moveEvent.clientX - startX)) } });
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };

  const pending = workspace.pendingNavigation;
  const dialogText = pending?.kind === "close-tab" ? `Save changes to ${pending.path} before closing?` : "Apply all changes before continuing?";

  return (
    <div className="app-shell" style={{ "--nav-width": `${workspace.layout.navCollapsed ? 56 : workspace.layout.navWidth}px`, "--tree-width": `${workspace.layout.treeWidth}px` } as React.CSSProperties}>
      <Sidebar activeView={activeView} collapsed={workspace.layout.navCollapsed} onViewChange={setActiveView} onBrowse={browse} onToggle={() => dispatch({ type: "SET_LAYOUT", layout: { navCollapsed: !workspace.layout.navCollapsed } })} />
      {!workspace.layout.navCollapsed && <div className="resize-handle nav-resize" onPointerDown={(event) => startResize("navWidth", event)} />}
      <section className="panel-left">
        {activeView === "files" ? <FileTree ref={searchRef} entries={entries} selected={workspace.activePath} onSelect={selectFile} expanded={expanded} onExpandedChange={setExpanded} /> : <div className="settings-placeholder"><h2>{activeView === "graphics" ? "Runtime" : activeView === "playground" ? "Workflow" : activeView === "cache" ? "Cache tools" : "Settings"}</h2><p className="muted">{gameInstall ? gameInstall.path : "Open a game installation first."}</p>{shaderIndex.cycles.length > 0 && <p className="warning-banner">{shaderIndex.cycles.length} shader include cycle(s) detected.</p>}</div>}
      </section>
      <div className="resize-handle tree-resize" onPointerDown={(event) => startResize("treeWidth", event)} />
      {activeView === "files" && <Editor tabs={workspace.tabs} activePath={workspace.activePath} onActivate={(path) => dispatch({ type: "ACTIVATE_TAB", path })} onClose={closeTab} onEdit={(path, draft) => dispatch({ type: "EDIT_TAB", path, draft })} onStage={(path) => void stageTab(path)} onApplyAll={() => void applyAll()} onDiscardActive={() => void revertActive()} onDiscardAll={() => void discardAll()} hasUnsavedWork={hasUnsavedWork(workspace)} diagnostics={diagnostics} materialSummary={materialSummary} shaderInfo={activeShader} shaderCompletions={[...new Set([...shaderIndex.macros, "uniform", "property", "fragment_in", "fragment_out", "vertex_in", "vertex_out", "sampler2D", "samplerCUBE", "half", "half2", "half3", "half4", "float", "float2", "float3", "float4"])]} onFormat={() => void formatActive()} onOpenInclude={openInclude} symbolNavigation={workspace.symbolNavigation} onPreviewSymbol={previewSymbol} onPinSymbol={pinSymbol} onTogglePin={() => dispatch({ type: "SET_SYMBOL_PINNED", pinned: !workspace.symbolNavigation.pinned })} onClearSymbol={() => dispatch({ type: "CLEAR_SYMBOL_MAP" })} onPreviousOccurrence={() => navigateByOffset(-1)} onNextOccurrence={() => navigateByOffset(1)} onNavigateOccurrence={(occurrence) => void navigateOccurrence(occurrence)} onGoToDefinition={goToDefinition} onRevealHandled={() => dispatch({ type: "SET_REVEAL_TARGET", target: null })} />}
      {activeView === "graphics" && <div className="tool-host"><GraphicsView running={gameRunning} onStatus={setStatus} /></div>}
      {activeView === "playground" && <div className="tool-host"><PlaygroundView running={gameRunning} hasChanges={hasUnsavedWork(workspace)} onApply={applyAll} onRefreshProcess={refreshProcess} onStatus={setStatus} /></div>}
      {activeView === "cache" && <div className="tool-host"><ShaderCacheView running={gameRunning} onStatus={setStatus} /></div>}
      {activeView === "settings" && <div className="tool-host"><div className="tool-view"><header><div><h2>Studio Settings</h2><p>Runtime path and installation details.</p></div></header><p><strong>Game:</strong> {gameInstall?.path ?? "Not selected"}</p><p><strong>Runtime:</strong> configure from Graphics → Runtime path.</p></div></div>}
      <StatusBar gameInstall={gameInstall} isDirty={workspace.stagedPaths.length > 0 || workspace.tabs.some((tab) => tab.status === "draft")} status={status} />

      {pending && <div className="modal-backdrop" role="presentation"><section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">Unsaved changes</h2><p>{dialogText}</p><div className="dialog-actions"><button className="ghost" onClick={() => void finishPending("cancel")}>Cancel</button><button className="danger-btn" onClick={() => void finishPending("discard")}>Discard</button><button className="primary" onClick={() => void finishPending("save")}>{pending.kind === "close-tab" ? "Stage & close" : "Apply all"}</button></div></section></div>}
    </div>
  );
}

export default App;

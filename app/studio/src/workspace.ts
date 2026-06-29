export type TabStatus = "loading" | "clean" | "draft" | "staged" | "binary" | "error";

export type OpenTab = {
  path: string;
  original: string;
  draft: string;
  status: TabStatus;
  requestId: number;
  binarySize?: number;
  error?: string;
};

export type PanelLayout = {
  navWidth: number;
  treeWidth: number;
  navCollapsed: boolean;
};

export type PendingNavigation =
  | { kind: "close-tab"; path: string }
  | { kind: "open-game"; path: string; install?: import("./App").GameInstall }
  | { kind: "exit" }
  | null;

export type SymbolOccurrence = {
  path: string; line: number; column: number; length: number;
  kind: "uniform_declaration" | "property_declaration" | "macro_definition" | "condition" | "entry_point_declaration" | "usage";
  preview: string;
};

export type SymbolMap = {
  symbol: string;
  occurrences: SymbolOccurrence[];
  missing_includes: string[];
  cycles: string[][];
  truncated: boolean;
};

export type RevealTarget = SymbolOccurrence & { requestId: number };

export type SymbolNavigationState = {
  symbol: string | null;
  pinned: boolean;
  loading: boolean;
  error: string | null;
  requestId: number;
  map: SymbolMap | null;
  currentIndex: number;
  reveal: RevealTarget | null;
};

export type WorkspaceState = {
  tabs: OpenTab[];
  activePath: string | null;
  stagedPaths: string[];
  layout: PanelLayout;
  pendingNavigation: PendingNavigation;
  symbolNavigation: SymbolNavigationState;
};

export type WorkspaceAction =
  | { type: "OPEN_TAB"; path: string; requestId: number }
  | { type: "LOAD_TEXT"; path: string; requestId: number; content: string }
  | { type: "LOAD_BINARY"; path: string; requestId: number; size: number }
  | { type: "LOAD_ERROR"; path: string; requestId: number; error: string }
  | { type: "ACTIVATE_TAB"; path: string }
  | { type: "EDIT_TAB"; path: string; draft: string }
  | { type: "MARK_STAGED"; paths: string[] }
  | { type: "MARK_APPLIED" }
  | { type: "DISCARD_DRAFT"; path: string }
  | { type: "REVERT_TAB"; path: string; content: string }
  | { type: "CLOSE_TAB"; path: string }
  | { type: "CLOSE_ALL" }
  | { type: "SET_STAGED_PATHS"; paths: string[] }
  | { type: "SET_LAYOUT"; layout: Partial<PanelLayout> }
  | { type: "SET_PENDING_NAVIGATION"; pending: PendingNavigation }
  | { type: "START_SYMBOL_MAP"; symbol: string; requestId: number; pinned: boolean }
  | { type: "SET_SYMBOL_MAP"; map: SymbolMap; requestId: number }
  | { type: "SET_SYMBOL_MAP_ERROR"; error: string; requestId: number }
  | { type: "SET_SYMBOL_PINNED"; pinned: boolean }
  | { type: "CLEAR_SYMBOL_MAP" }
  | { type: "SET_SYMBOL_INDEX"; index: number }
  | { type: "SET_REVEAL_TARGET"; target: RevealTarget | null };

export const DEFAULT_LAYOUT: PanelLayout = {
  navWidth: 220,
  treeWidth: 320,
  navCollapsed: false,
};

export function initialWorkspace(layout: PanelLayout = DEFAULT_LAYOUT): WorkspaceState {
  return { tabs: [], activePath: null, stagedPaths: [], layout, pendingNavigation: null, symbolNavigation: { symbol: null, pinned: false, loading: false, error: null, requestId: 0, map: null, currentIndex: -1, reveal: null } };
}

const normalize = (path: string) => path.replace(/\\/g, "/");

export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "OPEN_TAB": {
      const path = normalize(action.path);
      const existing = state.tabs.find((tab) => tab.path === path);
      if (existing) return { ...state, activePath: path };
      return {
        ...state,
        activePath: path,
        tabs: [...state.tabs, { path, original: "", draft: "", status: "loading", requestId: action.requestId }],
      };
    }
    case "LOAD_TEXT":
      return {
        ...state,
        tabs: state.tabs.map((tab) => tab.path === normalize(action.path) && tab.requestId === action.requestId
          ? { ...tab, original: action.content, draft: action.content, status: state.stagedPaths.includes(tab.path) ? "staged" : "clean", error: undefined }
          : tab),
      };
    case "LOAD_BINARY":
      return { ...state, tabs: state.tabs.map((tab) => tab.path === normalize(action.path) && tab.requestId === action.requestId ? { ...tab, status: "binary", binarySize: action.size } : tab) };
    case "LOAD_ERROR":
      return { ...state, tabs: state.tabs.map((tab) => tab.path === normalize(action.path) && tab.requestId === action.requestId ? { ...tab, status: "error", error: action.error } : tab) };
    case "ACTIVATE_TAB":
      return { ...state, activePath: normalize(action.path) };
    case "EDIT_TAB":
      return {
        ...state,
        tabs: state.tabs.map((tab) => tab.path === normalize(action.path)
          ? { ...tab, draft: action.draft, status: action.draft === tab.original ? (state.stagedPaths.includes(tab.path) ? "staged" : "clean") : "draft" }
          : tab),
      };
    case "MARK_STAGED": {
      const paths = action.paths.map(normalize);
      const stagedPaths = [...new Set([...state.stagedPaths, ...paths])].sort();
      return {
        ...state,
        stagedPaths,
        tabs: state.tabs.map((tab) => paths.includes(tab.path) ? { ...tab, original: tab.draft, status: "staged" } : tab),
      };
    }
    case "MARK_APPLIED":
      return { ...state, stagedPaths: [], tabs: state.tabs.map((tab) => tab.status === "staged" ? { ...tab, status: "clean" } : tab) };
    case "DISCARD_DRAFT":
      return { ...state, tabs: state.tabs.map((tab) => tab.path === normalize(action.path) ? { ...tab, draft: tab.original, status: state.stagedPaths.includes(tab.path) ? "staged" : "clean" } : tab) };
    case "REVERT_TAB":
      return {
        ...state,
        stagedPaths: state.stagedPaths.filter((path) => path !== normalize(action.path)),
        tabs: state.tabs.map((tab) => tab.path === normalize(action.path) ? { ...tab, original: action.content, draft: action.content, status: "clean" } : tab),
      };
    case "CLOSE_TAB": {
      const path = normalize(action.path);
      const index = state.tabs.findIndex((tab) => tab.path === path);
      const tabs = state.tabs.filter((tab) => tab.path !== path);
      const nextActive = state.activePath === path ? tabs[Math.min(index, tabs.length - 1)]?.path ?? null : state.activePath;
      return { ...state, tabs, activePath: nextActive };
    }
    case "CLOSE_ALL":
      return { ...state, tabs: [], activePath: null, stagedPaths: [], symbolNavigation: { symbol: null, pinned: false, loading: false, error: null, requestId: state.symbolNavigation.requestId, map: null, currentIndex: -1, reveal: null } };
    case "SET_STAGED_PATHS": {
      const paths = action.paths.map(normalize).sort();
      return { ...state, stagedPaths: paths, tabs: state.tabs.map((tab) => tab.status === "draft" ? tab : { ...tab, status: paths.includes(tab.path) ? "staged" : "clean" }) };
    }
    case "SET_LAYOUT":
      return { ...state, layout: { ...state.layout, ...action.layout } };
    case "SET_PENDING_NAVIGATION":
      return { ...state, pendingNavigation: action.pending };
    case "START_SYMBOL_MAP":
      return { ...state, symbolNavigation: { ...state.symbolNavigation, symbol: action.symbol, pinned: action.pinned, loading: true, error: null, requestId: action.requestId, currentIndex: -1 } };
    case "SET_SYMBOL_MAP":
      if (action.requestId !== state.symbolNavigation.requestId) return state;
      return { ...state, symbolNavigation: { ...state.symbolNavigation, symbol: action.map.symbol, map: action.map, loading: false, error: null, currentIndex: action.map.occurrences.length ? 0 : -1 } };
    case "SET_SYMBOL_MAP_ERROR":
      if (action.requestId !== state.symbolNavigation.requestId) return state;
      return { ...state, symbolNavigation: { ...state.symbolNavigation, loading: false, error: action.error, map: null, currentIndex: -1 } };
    case "SET_SYMBOL_PINNED":
      return { ...state, symbolNavigation: { ...state.symbolNavigation, pinned: action.pinned } };
    case "CLEAR_SYMBOL_MAP":
      return { ...state, symbolNavigation: { symbol: null, pinned: false, loading: false, error: null, requestId: state.symbolNavigation.requestId, map: null, currentIndex: -1, reveal: null } };
    case "SET_SYMBOL_INDEX":
      return { ...state, symbolNavigation: { ...state.symbolNavigation, currentIndex: action.index } };
    case "SET_REVEAL_TARGET":
      return { ...state, symbolNavigation: { ...state.symbolNavigation, reveal: action.target } };
  }
}

export const hasDrafts = (state: WorkspaceState) => state.tabs.some((tab) => tab.status === "draft");
export const hasUnsavedWork = (state: WorkspaceState) => hasDrafts(state) || state.stagedPaths.length > 0;

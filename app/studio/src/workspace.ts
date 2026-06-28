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

export type WorkspaceState = {
  tabs: OpenTab[];
  activePath: string | null;
  stagedPaths: string[];
  layout: PanelLayout;
  pendingNavigation: PendingNavigation;
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
  | { type: "SET_PENDING_NAVIGATION"; pending: PendingNavigation };

export const DEFAULT_LAYOUT: PanelLayout = {
  navWidth: 220,
  treeWidth: 320,
  navCollapsed: false,
};

export function initialWorkspace(layout: PanelLayout = DEFAULT_LAYOUT): WorkspaceState {
  return { tabs: [], activePath: null, stagedPaths: [], layout, pendingNavigation: null };
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
      return { ...state, tabs: [], activePath: null, stagedPaths: [] };
    case "SET_STAGED_PATHS": {
      const paths = action.paths.map(normalize).sort();
      return { ...state, stagedPaths: paths, tabs: state.tabs.map((tab) => tab.status === "draft" ? tab : { ...tab, status: paths.includes(tab.path) ? "staged" : "clean" }) };
    }
    case "SET_LAYOUT":
      return { ...state, layout: { ...state.layout, ...action.layout } };
    case "SET_PENDING_NAVIGATION":
      return { ...state, pendingNavigation: action.pending };
  }
}

export const hasDrafts = (state: WorkspaceState) => state.tabs.some((tab) => tab.status === "draft");
export const hasUnsavedWork = (state: WorkspaceState) => hasDrafts(state) || state.stagedPaths.length > 0;

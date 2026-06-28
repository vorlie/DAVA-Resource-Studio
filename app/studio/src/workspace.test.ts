import { describe, expect, it } from "vitest";
import { initialWorkspace, workspaceReducer } from "./workspace";

function loadedState(path = "Configs/a.yaml") {
  let state = initialWorkspace();
  state = workspaceReducer(state, { type: "OPEN_TAB", path, requestId: 1 });
  return workspaceReducer(state, { type: "LOAD_TEXT", path, requestId: 1, content: "a: 1" });
}

describe("workspaceReducer", () => {
  it("keeps independent drafts across tabs", () => {
    let state = loadedState();
    state = workspaceReducer(state, { type: "EDIT_TAB", path: "Configs/a.yaml", draft: "a: 2" });
    state = workspaceReducer(state, { type: "OPEN_TAB", path: "Shaders/b.slh", requestId: 2 });
    state = workspaceReducer(state, { type: "LOAD_TEXT", path: "Shaders/b.slh", requestId: 2, content: "shader" });

    expect(state.tabs[0].draft).toBe("a: 2");
    expect(state.tabs[0].status).toBe("draft");
    expect(state.activePath).toBe("Shaders/b.slh");
  });

  it("ignores stale read responses", () => {
    let state = initialWorkspace();
    state = workspaceReducer(state, { type: "OPEN_TAB", path: "a.txt", requestId: 4 });
    state = workspaceReducer(state, { type: "LOAD_TEXT", path: "a.txt", requestId: 3, content: "stale" });
    expect(state.tabs[0].status).toBe("loading");
  });

  it("stages, applies, and reverts files", () => {
    let state = loadedState();
    state = workspaceReducer(state, { type: "EDIT_TAB", path: "Configs/a.yaml", draft: "a: 2" });
    state = workspaceReducer(state, { type: "MARK_STAGED", paths: ["Configs/a.yaml"] });
    expect(state.stagedPaths).toEqual(["Configs/a.yaml"]);
    expect(state.tabs[0].status).toBe("staged");
    state = workspaceReducer(state, { type: "MARK_APPLIED" });
    expect(state.tabs[0].status).toBe("clean");
    expect(state.stagedPaths).toEqual([]);
  });

  it("selects a neighboring tab when closing the active tab", () => {
    let state = loadedState("a.txt");
    state = workspaceReducer(state, { type: "OPEN_TAB", path: "b.txt", requestId: 2 });
    state = workspaceReducer(state, { type: "CLOSE_TAB", path: "b.txt" });
    expect(state.activePath).toBe("a.txt");
  });

  it("stores pending navigation and persisted panel choices", () => {
    let state = initialWorkspace();
    state = workspaceReducer(state, { type: "SET_LAYOUT", layout: { treeWidth: 410, navCollapsed: true } });
    state = workspaceReducer(state, { type: "SET_PENDING_NAVIGATION", pending: { kind: "exit" } });
    expect(state.layout).toMatchObject({ treeWidth: 410, navCollapsed: true });
    expect(state.pendingNavigation).toEqual({ kind: "exit" });
  });
});

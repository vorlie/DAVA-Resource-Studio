import type { ActiveView } from "./App";
import type { TabStatus } from "./workspace";

export const PRESENCE_PREFERENCE_KEY = "dava-resource-studio.discord-presence.v1";

export type PresenceActivity = "resources" | "shader" | "material" | "editor" | "graphics" | "playground" | "cache" | "settings";
export type PresenceConnectionState = "disabled" | "connecting" | "connected" | "disconnected";

export interface PresenceStatus {
  enabled: boolean;
  state: PresenceConnectionState;
  message: string | null;
}

export const DISABLED_PRESENCE_STATUS: PresenceStatus = {
  enabled: false,
  state: "disabled",
  message: null,
};

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function readPresencePreference(storage: PreferenceStorage = localStorage): boolean {
  try { return storage.getItem(PRESENCE_PREFERENCE_KEY) === "true"; }
  catch { return false; }
}

export function writePresencePreference(enabled: boolean, storage: PreferenceStorage = localStorage): void {
  try { storage.setItem(PRESENCE_PREFERENCE_KEY, String(enabled)); }
  catch { /* The preference remains session-only if storage is unavailable. */ }
}

export function activityForView(activeView: ActiveView, path: string | null, status?: TabStatus): PresenceActivity {
  if (activeView !== "files") return activeView;
  if (!path || status === "binary" || status === "loading" || status === "error") return "resources";
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "sl" || extension === "slh") return "shader";
  if (extension === "material") return "material";
  return "editor";
}

import { describe, expect, it } from "vitest";
import { activityForView, PRESENCE_PREFERENCE_KEY, readPresencePreference, writePresencePreference } from "./presence";

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    getItem: (key: string) => key === PRESENCE_PREFERENCE_KEY ? value : null,
    setItem: (key: string, next: string) => { if (key === PRESENCE_PREFERENCE_KEY) value = next; },
  };
}

describe("Discord presence preferences", () => {
  it("defaults to disabled and restores only an explicit opt-in", () => {
    expect(readPresencePreference(memoryStorage())).toBe(false);
    expect(readPresencePreference(memoryStorage("false"))).toBe(false);
    expect(readPresencePreference(memoryStorage("true"))).toBe(true);
  });

  it("persists the boolean preference", () => {
    const storage = memoryStorage();
    writePresencePreference(true, storage);
    expect(readPresencePreference(storage)).toBe(true);
  });
});

describe("generic Discord activities", () => {
  it("maps tool views without resource details", () => {
    expect(activityForView("graphics", null)).toBe("graphics");
    expect(activityForView("playground", "secret/path.sl", "draft")).toBe("playground");
    expect(activityForView("cache", null)).toBe("cache");
    expect(activityForView("settings", null)).toBe("settings");
  });

  it("classifies editor resources by extension only", () => {
    expect(activityForView("files", "shaders/private.sl", "clean")).toBe("shader");
    expect(activityForView("files", "materials/tank.material", "draft")).toBe("material");
    expect(activityForView("files", "config/graphics.yaml", "staged")).toBe("editor");
    expect(activityForView("files", "textures/image.dds", "binary")).toBe("resources");
    expect(activityForView("files", null)).toBe("resources");
  });
});

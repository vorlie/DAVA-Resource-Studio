import { describe, expect, it } from "vitest";
import { languageKindForPath } from "./CodeEditor";

describe("editor language detection", () => {
  it.each([
    ["Materials/VertexColor.material", "yaml"],
    ["Configs/quality.yaml", "yaml"],
    ["Configs/options.yml", "yaml"],
    ["UI/layout.json", "json"],
    ["Shaders/pbr-lighting.slh", "shader"],
    ["Shaders/silhouette-fp.sl", "shader"],
    ["readme.txt", "plain"],
  ] as const)("maps %s to %s", (path, expected) => {
    expect(languageKindForPath(path)).toBe(expected);
  });
});

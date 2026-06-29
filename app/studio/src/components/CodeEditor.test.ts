import { describe, expect, it } from "vitest";
import { languageKindForPath, scanLocalSymbolOccurrences } from "./CodeEditor";

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

describe("live shader symbol scanner", () => {
  it("classifies declarations and usages while excluding comments and strings", () => {
    const text = "uniform float exposure;\nfloat value = exposure;\n// exposure\nconst char* text = \"exposure\";";
    const items = scanLocalSymbolOccurrences("shader.slh", text, "exposure");
    expect(items.map((item) => item.kind)).toEqual(["uniform_declaration", "usage"]);
    expect(items.map((item) => [item.line, item.column])).toEqual([[1, 15], [2, 15]]);
  });

  it("matches exact identifier boundaries", () => {
    expect(scanLocalSymbolOccurrences("shader.sl", "float exposureExtra; float exposure;", "exposure")).toHaveLength(1);
  });
});

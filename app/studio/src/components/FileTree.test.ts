import { describe, expect, it } from "vitest";
import { buildTree, sortedChildren } from "./FileTree";
import type { VfsEntry } from "../App";

const entry = (path: string): VfsEntry => ({ path, is_dvpl: path.endsWith("yaml"), size: 10 });

describe("resource tree", () => {
  it("normalizes Windows separators into nested folders", () => {
    const root = buildTree([entry("Configs\\Graphics\\quality.yaml")]);
    expect(root.children.get("Configs")?.children.get("Graphics")?.children.get("quality.yaml")?.entry?.path)
      .toBe("Configs\\Graphics\\quality.yaml");
  });

  it("sorts folders before files and names case-insensitively", () => {
    const root = buildTree([entry("z.txt"), entry("Beta/b.txt"), entry("alpha/a.txt")]);
    expect(sortedChildren(root).map((node) => node.name)).toEqual(["alpha", "Beta", "z.txt"]);
  });
});

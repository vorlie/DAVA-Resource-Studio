import { forwardRef, memo, useMemo, useState } from "react";
import type { VfsEntry } from "../App";

export type FileTreeProps = {
  entries: VfsEntry[];
  selected: string | null;
  onSelect: (vpath: string) => void;
  expanded: Set<string>;
  onExpandedChange: (expanded: Set<string>) => void;
};

type TreeNode = {
  name: string;
  path: string;
  entry?: VfsEntry;
  children: Map<string, TreeNode>;
};

export function buildTree(entries: VfsEntry[]): TreeNode {
  const root: TreeNode = { name: "Data", path: "", children: new Map() };

  for (const entry of entries) {
    const parts = entry.path.split(/[\\/]/).filter(Boolean);
    let parent = root;

    parts.forEach((name, index) => {
      const isFile = index === parts.length - 1;
      let node = parent.children.get(name);
      if (!node) {
        node = {
          name,
          path: parts.slice(0, index + 1).join("/"),
          children: new Map(),
        };
        parent.children.set(name, node);
      }
      if (isFile) node.entry = entry;
      parent = node;
    });
  }

  return root;
}

export function sortedChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    const aFolder = a.children.size > 0;
    const bFolder = b.children.size > 0;
    if (aFolder !== bFolder) return aFolder ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

type NodeProps = {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function TreeNodeView({ node, depth, expanded, selected, onToggle, onSelect }: NodeProps) {
  const isFolder = node.children.size > 0;
  const isOpen = expanded.has(node.path);
  const isActive = node.entry?.path === selected;

  return (
    <div role="treeitem" aria-expanded={isFolder ? isOpen : undefined}>
      <button
        className={`tree-row${isActive ? " active" : ""}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        title={node.path}
        onClick={() => isFolder ? onToggle(node.path) : node.entry && onSelect(node.entry.path)}
      >
        <span className={`tree-chevron${isFolder ? "" : " hidden"}`}>{isOpen ? "▾" : "▸"}</span>
        <span className="tree-icon" aria-hidden="true">{isFolder ? "■" : "·"}</span>
        <span className="file-name">{node.name}</span>
        {node.entry && <span className="file-meta">{node.entry.is_dvpl ? "dvpl" : "file"}</span>}
      </button>

      {isFolder && isOpen && (
        <div role="group">
          {sortedChildren(node).map((child) => (
            <TreeNodeView
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const FileTree = forwardRef<HTMLInputElement, FileTreeProps>(function FileTree(
  { entries, selected, onSelect, expanded, onExpandedChange },
  searchRef,
) {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredEntries = useMemo(() => normalizedQuery
    ? entries.filter((entry) => entry.path.replace(/\\/g, "/").toLocaleLowerCase().includes(normalizedQuery))
    : entries, [entries, normalizedQuery]);
  const tree = useMemo(() => buildTree(filteredEntries), [filteredEntries]);
  const searchExpanded = useMemo(() => {
    if (!normalizedQuery) return expanded;
    const paths = new Set(expanded);
    paths.add("");
    for (const entry of filteredEntries) {
      const parts = entry.path.split(/[\\/]/).filter(Boolean);
      for (let index = 1; index < parts.length; index += 1) paths.add(parts.slice(0, index).join("/"));
    }
    return paths;
  }, [expanded, filteredEntries, normalizedQuery]);

  const toggle = (path: string) => {
    {
      const next = new Set(expanded);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      onExpandedChange(next);
    }
  };

  return (
    <div className="filetree">
      <div className="filetree-header">Game resources</div>
      <div className="tree-search-wrap">
        <span aria-hidden="true">⌕</span>
        <input ref={searchRef} className="tree-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Data paths…" aria-label="Search resources" />
        {query && <button className="search-clear" onClick={() => setQuery("")} aria-label="Clear search">×</button>}
      </div>
      <div className="filetree-list" role="tree" aria-label="Data directory">
        {filteredEntries.length === 0 ? (
          <div className="empty">{entries.length ? "No matching resources." : "No game directory opened."}</div>
        ) : (
          <TreeNodeView
            node={tree}
            depth={0}
            expanded={searchExpanded}
            selected={selected}
            onToggle={toggle}
            onSelect={onSelect}
          />
        )}
      </div>
    </div>
  );
});

export default memo(FileTree);

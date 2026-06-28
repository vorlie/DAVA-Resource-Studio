import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type CacheEntry = { id: string; size: number; modified_ms: number; sha256: string; preview: string };
type Backup = { id: string; modified_ms: number; size: number };
type Comparison = { equal: boolean; size_a: number; size_b: number; differing_bytes: number; first_difference: number | null };

export default function ShaderCacheView({ running, onStatus }: { running: boolean; onStatus: (value: string) => void }) {
  const [entries, setEntries] = useState<CacheEntry[]>([]); const [backups, setBackups] = useState<Backup[]>([]);
  const [query, setQuery] = useState(""); const [a, setA] = useState(""); const [b, setB] = useState(""); const [comparison, setComparison] = useState<Comparison | null>(null);
  const [sort, setSort] = useState<"name" | "size" | "modified">("name");
  const refresh = useCallback(async () => { try { setEntries(await invoke("shader_cache_scan")); setBackups(await invoke("shader_cache_backups")); } catch (error) { onStatus(`Cache scan failed: ${error}`); } }, [onStatus]);
  useEffect(() => { void refresh(); }, [refresh]);
  const visible = useMemo(() => entries.filter((entry) => entry.id.toLowerCase().includes(query.toLowerCase())).sort((left, right) => sort === "size" ? right.size - left.size : sort === "modified" ? right.modified_ms - left.modified_ms : left.id.localeCompare(right.id)), [entries, query, sort]);
  const clear = async () => { if (!confirm("Move the current shader cache to a recoverable backup?")) return; try { const id = await invoke<string>("shader_cache_clear"); onStatus(`Shader cache moved to ${id}`); await refresh(); } catch (error) { onStatus(`Cache clear failed: ${error}`); } };
  const exportEntry = async (id: string) => { const destination = await open({ directory: true, multiple: false }); if (typeof destination === "string") { await invoke("shader_cache_export", { id, destination }); onStatus(`Exported ${id}`); } };
  const compare = async () => { if (a && b) setComparison(await invoke("shader_cache_compare", { a, b })); };
  const restore = async (id: string) => { if (!confirm(`Restore ${id}? The current cache will become another backup.`)) return; await invoke("shader_cache_restore", { id }); await refresh(); };
  const remove = async (id: string) => { if (!confirm(`Permanently delete ${id}?`)) return; await invoke("shader_cache_delete_backup", { id }); await refresh(); };
  return <div className="tool-view"><header><div><h2>Shader Cache</h2><p>{entries.length} opaque compiled entries · {(entries.reduce((sum, item) => sum + item.size, 0) / 1024).toFixed(1)} KiB</p></div><div className="tool-actions"><button className="ghost" onClick={() => void refresh()}>Refresh</button><button className="danger-btn" disabled={running} onClick={() => void clear()}>Backup & clear</button></div></header>
    {running && <div className="warning-banner">Cache mutations are disabled while the game is running.</div>}
    <div className="cache-compare"><select value={a} onChange={(e) => setA(e.target.value)}><option value="">First entry…</option>{entries.map((item) => <option key={item.id}>{item.id}</option>)}</select><select value={b} onChange={(e) => setB(e.target.value)}><option value="">Second entry…</option>{entries.map((item) => <option key={item.id}>{item.id}</option>)}</select><button className="ghost" disabled={!a || !b} onClick={() => void compare()}>Compare</button>{comparison && <span>{comparison.equal ? "Identical" : `${comparison.differing_bytes} differing bytes; first at ${comparison.first_difference}`}</span>}</div>
    <div className="cache-filter"><input className="tool-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter cache entries…" /><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="name">Name</option><option value="size">Largest</option><option value="modified">Newest</option></select></div>
    <div className="cache-table"><div className="cache-header"><span>Name</span><span>Size</span><span>SHA-256 / header</span><span /></div>{visible.map((entry) => <div className="cache-entry" key={entry.id}><code>{entry.id}</code><span>{entry.size.toLocaleString()} B</span><div><code>{entry.sha256.slice(0, 20)}…</code><small>{entry.preview}</small></div><button className="ghost" onClick={() => void exportEntry(entry.id)}>Export</button></div>)}</div>
    <section><h3>Recoverable cache backups</h3><div className="backup-list">{backups.map((backup) => <div key={backup.id}><code>{backup.id}</code><span className="button-pair"><button className="ghost" disabled={running} onClick={() => void restore(backup.id)}>Restore</button><button className="danger-btn" disabled={running} onClick={() => void remove(backup.id)}>Delete</button></span></div>)}</div></section>
  </div>;
}

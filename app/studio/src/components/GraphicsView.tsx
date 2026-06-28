import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

type GraphicsData = { path: string; recognized: Record<string, string>; unknown: Record<string, string> };
type Backup = { id: string; modified_ms: number; size: number };

const choices: Record<string, string[]> = {
  Antialiasing: ["Off", "2X", "4X", "8X"], AnisotropicFiltering: ["Off", "2X", "4X", "8X", "16X"],
  ShadowQuality: ["Off", "Low", "Medium", "High", "Ultra"], FogQuality: ["Off", "Low", "Medium", "High"],
  WaterQuality: ["Low", "Medium", "High"], GrassQuality: ["Off", "Low", "Medium", "High"],
  EffectsQuality: ["Low", "Medium", "High"], ObjectsQuality: ["Low", "Medium", "High"], VehiclesQuality: ["Low", "Medium", "High"],
  LevelOfDetail: ["Low", "Medium", "High"], HalfResolutionV2: ["Off", "On"], Quality: ["Low", "Medium", "High", "Ultra", "Customized"],
};
const booleans = new Set(["GrassInSniperMode", "HDTextures", "VSync", "Fullscreen", "TankTreads", "TankSuspension"]);

export default function GraphicsView({ running, onStatus }: { running: boolean; onStatus: (status: string) => void }) {
  const [data, setData] = useState<GraphicsData | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [backups, setBackups] = useState<Backup[]>([]);
  const load = useCallback(async () => {
    try { const next = await invoke<GraphicsData>("graphics_load"); setData(next); setValues(next.recognized); setBackups(await invoke("graphics_backups")); }
    catch (error) { onStatus(`Graphics settings unavailable: ${error}`); }
  }, [onStatus]);
  useEffect(() => { void load(); }, [load]);
  const selectRuntime = async () => { const path = await open({ directory: true, multiple: false }); if (typeof path === "string") { await invoke("runtime_set_path", { path }); await load(); } };
  const save = async () => { try { await invoke("graphics_save", { options: { values } }); onStatus("Graphics settings saved with backup."); await load(); } catch (error) { onStatus(`Could not save graphics settings: ${error}`); } };
  const restore = async (id: string) => { if (!confirm(`Restore ${id}? Current settings will be backed up.`)) return; try { await invoke("graphics_restore", { id }); await load(); onStatus("Graphics settings restored."); } catch (error) { onStatus(`Restore failed: ${error}`); } };
  return <div className="tool-view"><header><div><h2>Graphics Tweaker</h2><p>{data?.path ?? "Runtime settings not found"}</p></div><div className="tool-actions"><button className="ghost" onClick={() => void selectRuntime()}>Runtime path</button><button className="primary" disabled={running || !data} onClick={() => void save()}>Save settings</button></div></header>
    {running && <div className="warning-banner">Close World of Tanks Blitz before changing runtime settings.</div>}
    <div className="settings-grid">{Object.entries(values).map(([key, value]) => <label key={key}><span>{key}</span>{booleans.has(key) ? <select value={value} onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))}><option>true</option><option>false</option></select> : choices[key] ? <select value={value} onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))}>{[...new Set([...choices[key], value])].map((option) => <option key={option}>{option}</option>)}</select> : <input type={key === "FPSLimit" ? "number" : "text"} value={value} onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))} />}</label>)}</div>
    <details><summary>Unknown options ({Object.keys(data?.unknown ?? {}).length})</summary><div className="unknown-options">{Object.entries(data?.unknown ?? {}).map(([key, value]) => <div key={key}><code>{key}</code><span>{value}</span></div>)}</div></details>
    <section><h3>Settings backups</h3><div className="backup-list">{backups.map((backup) => <div key={backup.id}><code>{backup.id}</code><button className="ghost" disabled={running} onClick={() => void restore(backup.id)}>Restore</button></div>)}</div></section>
  </div>;
}

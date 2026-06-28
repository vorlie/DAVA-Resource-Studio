import { memo } from "react";

export type SidebarProps = {
  activeView: "files" | "graphics" | "playground" | "cache" | "settings";
  collapsed: boolean;
  onViewChange: (view: "files" | "graphics" | "playground" | "cache" | "settings") => void;
  onBrowse: () => void;
  onToggle: () => void;
};

function Sidebar({ activeView, collapsed, onViewChange, onBrowse, onToggle }: SidebarProps) {
  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-header">
        {!collapsed && <div className="app-title">DAVA Resource Studio</div>}
        <button className="icon-btn" onClick={onToggle} title={collapsed ? "Expand navigation" : "Collapse navigation"}>{collapsed ? "›" : "‹"}</button>
      </div>
      <nav className="sidebar-nav">
        <button className={activeView === "files" ? "nav-btn active" : "nav-btn"} onClick={() => onViewChange("files")} title="Files"><span>▤</span>{!collapsed && "Files"}</button>
        <button className={activeView === "settings" ? "nav-btn active" : "nav-btn"} onClick={() => onViewChange("settings")} title="Settings"><span>⚙</span>{!collapsed && "Settings"}</button>
        <button className={activeView === "graphics" ? "nav-btn active" : "nav-btn"} onClick={() => onViewChange("graphics")} title="Graphics"><span>◈</span>{!collapsed && "Graphics"}</button>
        <button className={activeView === "playground" ? "nav-btn active" : "nav-btn"} onClick={() => onViewChange("playground")} title="Shader Playground"><span>▶</span>{!collapsed && "Playground"}</button>
        <button className={activeView === "cache" ? "nav-btn active" : "nav-btn"} onClick={() => onViewChange("cache")} title="Shader Cache"><span>▦</span>{!collapsed && "Shader cache"}</button>
      </nav>
      <div className="sidebar-actions"><button className="primary" onClick={onBrowse} title="Open game folder">{collapsed ? "+" : "Open game folder"}</button></div>
      {!collapsed && <div className="sidebar-footer">Data workspace</div>}
    </aside>
  );
}

export default memo(Sidebar);

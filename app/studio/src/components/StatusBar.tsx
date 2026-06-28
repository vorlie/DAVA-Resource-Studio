import { memo } from "react";
import type { GameInstall } from "../App";

export type StatusBarProps = {
  gameInstall: GameInstall | null;
  isDirty: boolean;
  status: string;
};

function StatusBar({ gameInstall, isDirty, status }: StatusBarProps) {
  return (
    <footer className="statusbar">
      <div className="status-left">
        <div className="status-text">{status}</div>
        <div className="status-sub">
          {gameInstall ? `${gameInstall.edition} · ${gameInstall.version ?? "unknown"}` : "No game opened"}
        </div>
      </div>
      <div className="status-right">
        <span className={isDirty ? "status-pill dirty" : "status-pill"}>
          {isDirty ? "Dirty" : "OK"}
        </span>
      </div>
    </footer>
  );
}

export default memo(StatusBar);


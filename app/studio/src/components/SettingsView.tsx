import type { PresenceStatus } from "../presence";

interface SettingsViewProps {
  gamePath: string | null;
  presenceEnabled: boolean;
  presenceStatus: PresenceStatus;
  presenceBusy: boolean;
  onPresenceChange: (enabled: boolean) => void;
}

const stateLabel: Record<PresenceStatus["state"], string> = {
  disabled: "Disabled",
  connecting: "Connecting",
  connected: "Connected",
  disconnected: "Disconnected",
};

function SettingsView({ gamePath, presenceEnabled, presenceStatus, presenceBusy, onPresenceChange }: SettingsViewProps) {
  return (
    <div className="tool-host">
      <div className="tool-view">
        <header><div><h2>Studio Settings</h2><p>Application integrations and installation details.</p></div></header>

        <section className="settings-section">
          <div className="settings-heading">
            <div><h3>Discord Rich Presence</h3><p>Optionally show generic DAVA Resource Studio activity in Discord.</p></div>
            <span className={`presence-pill ${presenceStatus.state}`}>{stateLabel[presenceStatus.state]}</span>
          </div>
          <label className="toggle-setting">
            <span><strong>Share activity with Discord</strong><small>Off by default. Never shares filenames, paths, symbols, game-install details, links, or session duration.</small></span>
            <input
              type="checkbox"
              checked={presenceEnabled}
              disabled={presenceBusy}
              onChange={(event) => onPresenceChange(event.currentTarget.checked)}
            />
          </label>
          {presenceStatus.message && <p className="presence-message">{presenceStatus.message}</p>}
          <p className="privacy-note">Visibility also follows your Discord activity privacy settings. Discord Desktop must be running for Rich Presence to connect.</p>
        </section>

        <section className="settings-section">
          <h3>Paths</h3>
          <p><strong>Game:</strong> {gamePath ?? "Not selected"}</p>
          <p><strong>Runtime:</strong> configure from Graphics → Runtime path.</p>
        </section>
      </div>
    </div>
  );
}

export default SettingsView;

use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::{Deserialize, Serialize};
use std::{
    sync::{mpsc, Arc, Mutex},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use tauri::State;

const APPLICATION_ID: &str = "1163291215626768424";
const LARGE_IMAGE_KEY: &str = "dava_resource_studio";
const RETRY_DELAYS: [Duration; 4] = [
    Duration::from_secs(2),
    Duration::from_secs(5),
    Duration::from_secs(10),
    Duration::from_secs(30),
];

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceActivity {
    #[default]
    Resources,
    Shader,
    Material,
    Editor,
    Graphics,
    Playground,
    Cache,
    Settings,
}

impl PresenceActivity {
    fn details(self) -> &'static str {
        match self {
            Self::Resources => "Browsing resources",
            Self::Shader => "Editing a shader",
            Self::Material => "Inspecting a material",
            Self::Editor => "Editing resources",
            Self::Graphics => "Tuning graphics settings",
            Self::Playground => "Using Shader Playground",
            Self::Cache => "Inspecting shader cache",
            Self::Settings => "Studio settings",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceConnectionState {
    #[default]
    Disabled,
    Connecting,
    Connected,
    Disconnected,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PresenceStatus {
    pub enabled: bool,
    pub state: PresenceConnectionState,
    pub message: Option<String>,
}

trait PresenceClient: Send {
    fn connect(&mut self) -> Result<(), ()>;
    fn set_activity(&mut self, activity: PresenceActivity) -> Result<(), ()>;
    fn clear_activity(&mut self) -> Result<(), ()>;
    fn close(&mut self);
}

struct DiscordClient(DiscordIpcClient);

impl DiscordClient {
    fn create() -> Result<Box<dyn PresenceClient>, ()> {
        Ok(Box::new(Self(DiscordIpcClient::new(APPLICATION_ID))))
    }
}

impl PresenceClient for DiscordClient {
    fn connect(&mut self) -> Result<(), ()> {
        self.0.connect().map_err(|_| ())
    }

    fn set_activity(&mut self, selected: PresenceActivity) -> Result<(), ()> {
        let payload = activity::Activity::new()
            .details(selected.details())
            .assets(
                activity::Assets::new()
                    .large_image(LARGE_IMAGE_KEY)
                    .large_text("DAVA Resource Studio"),
            );
        self.0.set_activity(payload).map_err(|_| ())
    }

    fn clear_activity(&mut self) -> Result<(), ()> {
        self.0.clear_activity().map_err(|_| ())
    }

    fn close(&mut self) {
        let _ = self.0.close();
    }
}

type ClientFactory = Arc<dyn Fn() -> Result<Box<dyn PresenceClient>, ()> + Send + Sync>;

enum WorkerCommand {
    SetEnabled(bool),
    SetActivity(PresenceActivity),
    Shutdown,
}

pub struct PresenceService {
    sender: Mutex<Option<mpsc::Sender<WorkerCommand>>>,
    status: Arc<Mutex<PresenceStatus>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl PresenceService {
    pub fn new() -> Self {
        Self::with_factory(Arc::new(DiscordClient::create), RETRY_DELAYS.to_vec())
    }

    fn with_factory(factory: ClientFactory, retry_delays: Vec<Duration>) -> Self {
        let (sender, receiver) = mpsc::channel();
        let status = Arc::new(Mutex::new(PresenceStatus::default()));
        let worker_status = Arc::clone(&status);
        let worker = thread::Builder::new()
            .name("discord-presence".into())
            .spawn(move || run_worker(receiver, worker_status, factory, retry_delays))
            .expect("failed to start Discord presence worker");

        Self {
            sender: Mutex::new(Some(sender)),
            status,
            worker: Mutex::new(Some(worker)),
        }
    }

    pub fn set_enabled(&self, enabled: bool) -> Result<PresenceStatus, String> {
        let previous = self.status();
        self.set_status(if enabled {
            PresenceStatus {
                enabled: true,
                state: PresenceConnectionState::Connecting,
                message: Some("Connecting to Discord…".into()),
            }
        } else {
            PresenceStatus::default()
        });
        if let Err(error) = self.send(WorkerCommand::SetEnabled(enabled)) {
            self.set_status(previous);
            return Err(error);
        }
        Ok(self.status())
    }

    pub fn set_activity(&self, activity: PresenceActivity) -> Result<(), String> {
        self.send(WorkerCommand::SetActivity(activity))
    }

    pub fn status(&self) -> PresenceStatus {
        self.status
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub fn shutdown(&self) {
        if let Some(sender) = self
            .sender
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            let _ = sender.send(WorkerCommand::Shutdown);
        }
        if let Some(worker) = self
            .worker
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
        {
            let _ = worker.join();
        }
    }

    fn send(&self, command: WorkerCommand) -> Result<(), String> {
        let sender = self
            .sender
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        sender
            .as_ref()
            .ok_or_else(|| "Discord presence is shutting down.".to_string())?
            .send(command)
            .map_err(|_| "Discord presence worker is unavailable.".to_string())
    }

    fn set_status(&self, status: PresenceStatus) {
        *self
            .status
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = status;
    }
}

impl Drop for PresenceService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn update_status(status: &Arc<Mutex<PresenceStatus>>, value: PresenceStatus) {
    *status.lock().unwrap_or_else(|error| error.into_inner()) = value;
}

fn disconnect(client: &mut Option<Box<dyn PresenceClient>>) {
    if let Some(mut connected) = client.take() {
        connected.close();
    }
}

fn retry_delay(delays: &[Duration], attempt: usize) -> Duration {
    delays
        .get(attempt)
        .or_else(|| delays.last())
        .copied()
        .unwrap_or(Duration::from_secs(30))
}

fn run_worker(
    receiver: mpsc::Receiver<WorkerCommand>,
    status: Arc<Mutex<PresenceStatus>>,
    factory: ClientFactory,
    retry_delays: Vec<Duration>,
) {
    let mut enabled = false;
    let mut selected = PresenceActivity::default();
    let mut client: Option<Box<dyn PresenceClient>> = None;
    let mut attempt = 0usize;
    let mut next_attempt = Instant::now();

    loop {
        let timeout = if enabled && client.is_none() {
            next_attempt.saturating_duration_since(Instant::now())
        } else {
            Duration::from_secs(24 * 60 * 60)
        };

        match receiver.recv_timeout(timeout) {
            Ok(WorkerCommand::SetEnabled(value)) => {
                enabled = value;
                attempt = 0;
                next_attempt = Instant::now();
                if !enabled {
                    if let Some(connected) = client.as_mut() {
                        let _ = connected.clear_activity();
                    }
                    disconnect(&mut client);
                    update_status(&status, PresenceStatus::default());
                }
            }
            Ok(WorkerCommand::SetActivity(activity)) => {
                selected = activity;
                if let Some(connected) = client.as_mut() {
                    if connected.set_activity(selected).is_err() {
                        disconnect(&mut client);
                        next_attempt = Instant::now() + retry_delay(&retry_delays, attempt);
                        attempt = attempt.saturating_add(1);
                        update_status(&status, disconnected_status());
                    }
                }
            }
            Ok(WorkerCommand::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        if enabled && client.is_none() && Instant::now() >= next_attempt {
            update_status(
                &status,
                PresenceStatus {
                    enabled: true,
                    state: PresenceConnectionState::Connecting,
                    message: Some("Connecting to Discord…".into()),
                },
            );

            let connection = factory().and_then(|mut candidate| {
                candidate.connect()?;
                candidate.set_activity(selected)?;
                Ok(candidate)
            });

            match connection {
                Ok(connected) => {
                    client = Some(connected);
                    attempt = 0;
                    update_status(
                        &status,
                        PresenceStatus {
                            enabled: true,
                            state: PresenceConnectionState::Connected,
                            message: None,
                        },
                    );
                }
                Err(()) => {
                    next_attempt = Instant::now() + retry_delay(&retry_delays, attempt);
                    attempt = attempt.saturating_add(1);
                    update_status(&status, disconnected_status());
                }
            }
        }
    }

    if let Some(connected) = client.as_mut() {
        let _ = connected.clear_activity();
    }
    disconnect(&mut client);
    update_status(&status, PresenceStatus::default());
}

fn disconnected_status() -> PresenceStatus {
    PresenceStatus {
        enabled: true,
        state: PresenceConnectionState::Disconnected,
        message: Some("Discord desktop client is unavailable. Retrying silently.".into()),
    }
}

#[tauri::command]
pub fn presence_set_enabled(
    enabled: bool,
    state: State<'_, crate::AppState>,
) -> Result<PresenceStatus, String> {
    state.presence.set_enabled(enabled)
}

#[tauri::command]
pub fn presence_set_activity(
    activity: PresenceActivity,
    state: State<'_, crate::AppState>,
) -> Result<(), String> {
    state.presence.set_activity(activity)
}

#[tauri::command]
pub fn presence_status(state: State<'_, crate::AppState>) -> PresenceStatus {
    state.presence.status()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn activities_are_generic_and_contain_no_path_like_data() {
        let activities = [
            PresenceActivity::Resources,
            PresenceActivity::Shader,
            PresenceActivity::Material,
            PresenceActivity::Editor,
            PresenceActivity::Graphics,
            PresenceActivity::Playground,
            PresenceActivity::Cache,
            PresenceActivity::Settings,
        ];
        for selected in activities {
            let details = selected.details();
            assert!(!details.contains('/') && !details.contains('\\'));
            assert!(!details.contains('.'));
        }
    }

    #[test]
    fn retry_delays_are_capped_at_the_last_value() {
        assert_eq!(retry_delay(&RETRY_DELAYS, 0), Duration::from_secs(2));
        assert_eq!(retry_delay(&RETRY_DELAYS, 2), Duration::from_secs(10));
        assert_eq!(retry_delay(&RETRY_DELAYS, 20), Duration::from_secs(30));
    }

    struct RecordingClient {
        clears: Arc<AtomicUsize>,
        updates: Arc<AtomicUsize>,
    }

    impl PresenceClient for RecordingClient {
        fn connect(&mut self) -> Result<(), ()> {
            Ok(())
        }
        fn set_activity(&mut self, _: PresenceActivity) -> Result<(), ()> {
            self.updates.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn clear_activity(&mut self) -> Result<(), ()> {
            self.clears.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
        fn close(&mut self) {}
    }

    #[test]
    fn disabling_clears_the_connected_activity() {
        let clears = Arc::new(AtomicUsize::new(0));
        let updates = Arc::new(AtomicUsize::new(0));
        let factory_clears = Arc::clone(&clears);
        let factory_updates = Arc::clone(&updates);
        let service = PresenceService::with_factory(
            Arc::new(move || {
                Ok(Box::new(RecordingClient {
                    clears: Arc::clone(&factory_clears),
                    updates: Arc::clone(&factory_updates),
                }))
            }),
            vec![Duration::from_millis(1)],
        );

        service.set_enabled(true).unwrap();
        for _ in 0..100 {
            if service.status().state == PresenceConnectionState::Connected {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(service.status().state, PresenceConnectionState::Connected);
        service.set_enabled(false).unwrap();
        for _ in 0..100 {
            if clears.load(Ordering::SeqCst) == 1 {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(clears.load(Ordering::SeqCst), 1);
        let updates_before_disabled_change = updates.load(Ordering::SeqCst);
        assert!(updates_before_disabled_change >= 1);
        service.set_activity(PresenceActivity::Cache).unwrap();
        thread::sleep(Duration::from_millis(5));
        assert_eq!(
            updates.load(Ordering::SeqCst),
            updates_before_disabled_change
        );
        service.shutdown();
    }

    struct ActivityClient(Arc<Mutex<Vec<PresenceActivity>>>);

    impl PresenceClient for ActivityClient {
        fn connect(&mut self) -> Result<(), ()> {
            Ok(())
        }
        fn set_activity(&mut self, activity: PresenceActivity) -> Result<(), ()> {
            self.0.lock().unwrap().push(activity);
            Ok(())
        }
        fn clear_activity(&mut self) -> Result<(), ()> {
            Ok(())
        }
        fn close(&mut self) {}
    }

    #[test]
    fn retry_replays_the_latest_activity() {
        let attempts = Arc::new(AtomicUsize::new(0));
        let activities = Arc::new(Mutex::new(Vec::new()));
        let factory_attempts = Arc::clone(&attempts);
        let factory_activities = Arc::clone(&activities);
        let service = PresenceService::with_factory(
            Arc::new(move || {
                if factory_attempts.fetch_add(1, Ordering::SeqCst) == 0 {
                    Err(())
                } else {
                    Ok(Box::new(ActivityClient(Arc::clone(&factory_activities))))
                }
            }),
            vec![Duration::from_millis(1)],
        );

        service.set_activity(PresenceActivity::Material).unwrap();
        service.set_enabled(true).unwrap();
        for _ in 0..100 {
            if service.status().state == PresenceConnectionState::Connected {
                break;
            }
            thread::sleep(Duration::from_millis(1));
        }

        assert_eq!(service.status().state, PresenceConnectionState::Connected);
        assert!(attempts.load(Ordering::SeqCst) >= 2);
        assert_eq!(
            *activities.lock().unwrap(),
            vec![PresenceActivity::Material]
        );
        service.shutdown();
    }
}

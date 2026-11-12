use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::path::BaseDirectory;
use tauri::{Manager, RunEvent, WindowEvent};

const APP_URL: &str = match option_env!("FLAREBOT_APP_URL") {
    Some(url) => url,
    None => "http://127.0.0.1:8787",
};

struct Daemon(Mutex<Option<Child>>);

fn bun_path() -> PathBuf {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".bun/bin/bun"))
        .filter(|path| path.exists())
        .unwrap_or_else(|| PathBuf::from("bun"))
}

fn start_daemon(script: PathBuf) -> Option<Child> {
    match Command::new(bun_path())
        .arg(script)
        .args(["run", "--url", APP_URL])
        .stdin(Stdio::null())
        .spawn()
    {
        Ok(child) => Some(child),
        Err(error) => {
            eprintln!("flarebot-local did not start: {error}");
            None
        }
    }
}

fn stop_daemon(mut child: Child) {
    let _ = Command::new("kill").arg(child.id().to_string()).status();
    let _ = child.wait();
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let daemon = match app.path().resolve("daemon/flarebot-local.ts", BaseDirectory::Resource) {
                Ok(script) => start_daemon(script),
                Err(error) => {
                    eprintln!("flarebot-local was not found: {error}");
                    None
                }
            };
            app.manage(Daemon(Mutex::new(daemon)));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("failed to build Flarebot");

    app.run(|app, event| match event {
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => show_main_window(app),
        RunEvent::Exit => {
            if let Some(daemon) = app.try_state::<Daemon>() {
                if let Some(child) = daemon.0.lock().ok().and_then(|mut guard| guard.take()) {
                    stop_daemon(child);
                }
            }
        }
        _ => {}
    });
}

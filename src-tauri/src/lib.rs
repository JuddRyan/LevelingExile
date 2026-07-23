mod game_hotkeys;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewWindow};

use game_hotkeys::{set_game_hotkeys, GameHotkeys};

/// When true, skip aggressive Win32 topmost refresh (keeps native menus/dropdowns usable).
static PAUSE_TOPMOST_REFRESH: AtomicBool = AtomicBool::new(false);

/// Last visibility we applied while syncing with Path of Exile focus.
static OVERLAY_SHOWN: AtomicBool = AtomicBool::new(true);

/// Tray toggle: keep overlay visible for setup/import when PoE is not running.
static FORCE_SHOW_WHEN_POE_OFF: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "windows")]
fn force_hwnd_topmost(window: &WebviewWindow) {
  use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
  };

  let window = window.clone();
  let _ = window.clone().run_on_main_thread(move || {
    if let Ok(hwnd) = window.hwnd() {
      unsafe {
        // Avoid SWP_SHOWWINDOW — it can reorder/clip child popups (e.g. <select>).
        let _ = SetWindowPos(
          hwnd,
          Some(HWND_TOPMOST),
          0,
          0,
          0,
          0,
          SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
      }
    }
  });
}

#[cfg(not(target_os = "windows"))]
fn force_hwnd_topmost(window: &WebviewWindow) {
  let _ = window.set_always_on_top(true);
}

fn force_main_topmost(app: &AppHandle) {
  if PAUSE_TOPMOST_REFRESH.load(Ordering::SeqCst) {
    return;
  }

  if let Some(window) = app.get_webview_window("main") {
    // Don't fight the OS while the user is interacting (dropdowns/menus open).
    if window.is_focused().unwrap_or(false) {
      let _ = window.set_always_on_top(true);
      return;
    }

    let _ = window.set_always_on_top(true);
    force_hwnd_topmost(&window);
  }
}

#[cfg(target_os = "windows")]
mod poe_detect {
  use windows::Win32::Foundation::{CloseHandle, HWND};
  use windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
    TH32CS_SNAPPROCESS,
  };
  use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId,
  };

  fn is_poe_exe_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    // PathOfExile.exe, PathOfExile_x64.exe, PathOfExileSteam.exe, etc.
    lower.starts_with("pathofexile") && lower.ends_with(".exe")
  }

  fn exe_name_from_entry(entry: &PROCESSENTRY32W) -> String {
    let len = entry
      .szExeFile
      .iter()
      .position(|&c| c == 0)
      .unwrap_or(entry.szExeFile.len());
    String::from_utf16_lossy(&entry.szExeFile[..len])
  }

  /// Returns (poe_running, foreground_is_poe).
  pub fn poe_state() -> (bool, bool) {
    unsafe {
      let snapshot = match CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) {
        Ok(h) => h,
        Err(_) => return (false, false),
      };

      let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
      };

      let mut poe_running = false;
      let mut poe_pids: Vec<u32> = Vec::new();

      if Process32FirstW(snapshot, &mut entry).is_ok() {
        loop {
          let name = exe_name_from_entry(&entry);
          if is_poe_exe_name(&name) {
            poe_running = true;
            poe_pids.push(entry.th32ProcessID);
          }
          if Process32NextW(snapshot, &mut entry).is_err() {
            break;
          }
        }
      }

      let _ = CloseHandle(snapshot);

      if !poe_running {
        return (false, false);
      }

      let fg = GetForegroundWindow();
      if fg == HWND::default() {
        return (true, false);
      }

      let mut fg_pid = 0u32;
      GetWindowThreadProcessId(fg, Some(&mut fg_pid));
      let foreground_is_poe = poe_pids.iter().any(|&pid| pid == fg_pid);
      (true, foreground_is_poe)
    }
  }
}

/// Sync overlay visibility with PoE:
/// - PoE off + force-show off → hide
/// - PoE off + force-show on → show (setup/import)
/// - PoE on → show when PoE or overlay focused; hide otherwise
fn sync_overlay_with_game(app: &AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };

  #[cfg(target_os = "windows")]
  {
    let (poe_running, poe_focused) = poe_detect::poe_state();
    let overlay_focused = window.is_focused().unwrap_or(false);
    let force_show = FORCE_SHOW_WHEN_POE_OFF.load(Ordering::SeqCst);

    if !poe_running {
      if force_show {
        if !OVERLAY_SHOWN.swap(true, Ordering::SeqCst) {
          let _ = window.show();
        }
      } else if OVERLAY_SHOWN.swap(false, Ordering::SeqCst) {
        let _ = window.hide();
      }
      return;
    }

    if !poe_focused && !overlay_focused {
      if OVERLAY_SHOWN.swap(false, Ordering::SeqCst) {
        let _ = window.hide();
      }
      return;
    }

    if !OVERLAY_SHOWN.swap(true, Ordering::SeqCst) {
      let _ = window.show();
    }

    force_main_topmost(app);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = window.show();
    force_main_topmost(app);
  }
}

#[tauri::command]
fn force_always_on_top(app: AppHandle) {
  // Explicit request from UI — always apply, even if paused.
  if let Some(window) = app.get_webview_window("main") {
    let _ = window.show();
    OVERLAY_SHOWN.store(true, Ordering::SeqCst);
    let _ = window.set_always_on_top(true);
    force_hwnd_topmost(&window);
  }
}

#[tauri::command]
fn set_topmost_paused(paused: bool) {
  PAUSE_TOPMOST_REFRESH.store(paused, Ordering::SeqCst);
}

#[tauri::command]
fn exit_app(app: AppHandle) {
  app.exit(0);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
  let force_show = CheckMenuItem::with_id(
    app,
    "force_show",
    "Show when game is off",
    true,
    FORCE_SHOW_WHEN_POE_OFF.load(Ordering::SeqCst),
    None::<&str>,
  )?;
  let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&force_show, &exit])?;

  let force_show_item = force_show.clone();
  let mut tray = TrayIconBuilder::with_id("main")
    .menu(&menu)
    .tooltip("LevelingExile")
    .show_menu_on_left_click(true)
    .on_menu_event(move |app, event| match event.id.as_ref() {
      "force_show" => {
        let next = !FORCE_SHOW_WHEN_POE_OFF.load(Ordering::SeqCst);
        FORCE_SHOW_WHEN_POE_OFF.store(next, Ordering::SeqCst);
        let _ = force_show_item.set_checked(next);
        sync_overlay_with_game(app);
      }
      "exit" => {
        app.exit(0);
      }
      _ => {}
    });

  if let Some(icon) = app.default_window_icon() {
    tray = tray.icon(icon.clone());
  }

  let _ = tray.build(app)?;
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    .plugin(tauri_plugin_http::init())
    .manage(Mutex::new(GameHotkeys::default()))
    .invoke_handler(tauri::generate_handler![
      force_always_on_top,
      set_topmost_paused,
      exit_app,
      set_game_hotkeys
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      setup_tray(app.handle())?;
      sync_overlay_with_game(app.handle());

      // Poll PoE process + foreground focus; re-assert topmost while in game.
      let handle = app.handle().clone();
      std::thread::spawn(move || {
        loop {
          std::thread::sleep(std::time::Duration::from_millis(500));
          sync_overlay_with_game(&handle);
        }
      });

      // Layout-aware hotkeys (fixes Alt+Backquote on ISO/EU keyboards).
      let hotkey_handle = app.handle().clone();
      std::thread::spawn(move || {
        loop {
          std::thread::sleep(std::time::Duration::from_millis(40));
          game_hotkeys::poll(&hotkey_handle);
        }
      });

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

//! Layout-aware global hotkeys via GetAsyncKeyState.
//!
//! The Tauri global-shortcut plugin maps `Backquote` to VK_OEM_3 (US `` ` ``).
//! On many ISO/EU layouts the physical key above Tab is a different VK, so
//! RegisterHotKey never fires. We resolve that key via scan code 0x29.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Copy, Debug)]
struct ParsedHotkey {
  ctrl: bool,
  alt: bool,
  shift: bool,
  super_key: bool,
  vk: u16,
}

#[derive(Default)]
pub struct GameHotkeys {
  complete: Option<ParsedHotkey>,
  interact: Option<ParsedHotkey>,
  overlay_toggle: Option<ParsedHotkey>,
  complete_was_down: bool,
  interact_was_down: bool,
  overlay_toggle_was_down: bool,
}

fn key_to_vk(key: &str) -> Option<u16> {
  let upper = key.to_ascii_uppercase();
  match upper.as_str() {
    "BACKQUOTE" | "`" | "~" | "GRAVE" | "BACKTICK" => {
      #[cfg(windows)]
      {
        use windows::Win32::UI::Input::KeyboardAndMouse::{MapVirtualKeyW, MAPVK_VSC_TO_VK_EX};
        // Physical key left of 1 / above Tab (USB HID / PS/2 OEM3 position).
        let mapped = unsafe { MapVirtualKeyW(0x29, MAPVK_VSC_TO_VK_EX) };
        Some(if mapped == 0 { 0xC0 } else { mapped as u16 })
      }
      #[cfg(not(windows))]
      {
        Some(0xC0)
      }
    }
    "SPACE" => Some(0x20),
    s if s.len() == 1 => {
      let c = s.chars().next()?.to_ascii_uppercase();
      if c.is_ascii_alphanumeric() {
        Some(c as u16)
      } else {
        None
      }
    }
    s if s.starts_with('F') && s.len() <= 3 => {
      let n: u16 = s[1..].parse().ok()?;
      if (1..=24).contains(&n) {
        Some(0x70 + n - 1)
      } else {
        None
      }
    }
    _ => None,
  }
}

fn parse_hotkey(raw: &str) -> Option<ParsedHotkey> {
  let parts: Vec<&str> = raw
    .split('+')
    .map(str::trim)
    .filter(|p| !p.is_empty())
    .collect();
  if parts.len() < 2 {
    return None;
  }

  let mut ctrl = false;
  let mut alt = false;
  let mut shift = false;
  let mut super_key = false;
  for m in &parts[..parts.len() - 1] {
    match m.to_ascii_lowercase().as_str() {
      "ctrl" | "control" | "commandorcontrol" => ctrl = true,
      "alt" => alt = true,
      "shift" => shift = true,
      "super" | "meta" | "cmd" | "command" => super_key = true,
      _ => return None,
    }
  }

  let vk = key_to_vk(parts.last()?)?;
  Some(ParsedHotkey {
    ctrl,
    alt,
    shift,
    super_key,
    vk,
  })
}

#[cfg(windows)]
fn is_down(vk: u16) -> bool {
  use windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
  unsafe { (GetAsyncKeyState(i32::from(vk)) as u16) & 0x8000 != 0 }
}

#[cfg(windows)]
fn combo_matches(h: &ParsedHotkey) -> bool {
  use windows::Win32::UI::Input::KeyboardAndMouse::{
    VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
  };

  let ctrl = is_down(VK_CONTROL.0);
  let alt = is_down(VK_MENU.0);
  let shift = is_down(VK_SHIFT.0);
  let win = is_down(VK_LWIN.0) || is_down(VK_RWIN.0);

  ctrl == h.ctrl
    && alt == h.alt
    && shift == h.shift
    && win == h.super_key
    && is_down(h.vk)
}

#[cfg(not(windows))]
fn combo_matches(_h: &ParsedHotkey) -> bool {
  false
}

fn same_binding(a: Option<&str>, b: Option<&str>) -> bool {
  match (a, b) {
    (Some(x), Some(y)) => x.eq_ignore_ascii_case(y),
    _ => false,
  }
}

pub fn poll(app: &AppHandle) {
  let Some(state) = app.try_state::<Mutex<GameHotkeys>>() else {
    return;
  };
  let Ok(mut g) = state.lock() else {
    return;
  };

  let mut fire_complete = false;
  let mut fire_interact = false;
  let mut fire_overlay_toggle = false;

  if let Some(ref h) = g.complete {
    let down = combo_matches(h);
    if down && !g.complete_was_down {
      fire_complete = true;
    }
    g.complete_was_down = down;
  } else {
    g.complete_was_down = false;
  }

  if let Some(ref h) = g.interact {
    let down = combo_matches(h);
    if down && !g.interact_was_down {
      fire_interact = true;
    }
    g.interact_was_down = down;
  } else {
    g.interact_was_down = false;
  }

  if let Some(ref h) = g.overlay_toggle {
    let down = combo_matches(h);
    if down && !g.overlay_toggle_was_down {
      fire_overlay_toggle = true;
    }
    g.overlay_toggle_was_down = down;
  } else {
    g.overlay_toggle_was_down = false;
  }

  drop(g);

  if fire_complete {
    let _ = app.emit("game-hotkey", "complete");
  }
  if fire_interact {
    let _ = app.emit("game-hotkey", "interact");
  }
  if fire_overlay_toggle {
    let _ = app.emit("game-hotkey", "overlay-toggle");
    crate::toggle_overlay_user_hidden(app);
  }
}

#[tauri::command]
pub fn set_game_hotkeys(
  state: State<'_, Mutex<GameHotkeys>>,
  complete: Option<String>,
  interact: Option<String>,
  overlay_toggle: Option<String>,
) -> Result<(), String> {
  let mut g = state.lock().map_err(|_| "hotkey state lock poisoned")?;

  g.complete = match complete.as_deref() {
    None | Some("") => None,
    Some(s) => Some(
      parse_hotkey(s).ok_or_else(|| format!("Invalid complete hotkey: {s}"))?,
    ),
  };

  g.interact = match interact.as_deref() {
    None | Some("") => None,
    Some(s) => {
      // Same binding as complete → only complete fires.
      if same_binding(complete.as_deref(), Some(s)) {
        None
      } else {
        Some(parse_hotkey(s).ok_or_else(|| format!("Invalid interact hotkey: {s}"))?)
      }
    }
  };

  g.overlay_toggle = match overlay_toggle.as_deref() {
    None | Some("") => None,
    Some(s) => {
      // Same as complete or interact → skip (those take priority).
      if same_binding(complete.as_deref(), Some(s))
        || same_binding(interact.as_deref(), Some(s))
      {
        None
      } else {
        Some(
          parse_hotkey(s)
            .ok_or_else(|| format!("Invalid overlay toggle hotkey: {s}"))?,
        )
      }
    }
  };

  g.complete_was_down = false;
  g.interact_was_down = false;
  g.overlay_toggle_was_down = false;
  Ok(())
}

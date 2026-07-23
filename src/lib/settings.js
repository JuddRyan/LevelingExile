export const DEFAULT_SETTINGS = {
  scale: 100, // percent — must be one of SCALE_STEPS
  width: 320,
  height: 450,
  autoAdvanceSkillSet: true,
  showNextUp: true,
  hideCompletedGems: false,
  hotkeyComplete: 'Alt+N',
  hotkeyInteract: 'Alt+B',
};

/** Fixed UI scale presets (percent). */
export const SCALE_STEPS = [50, 75, 90, 100, 110, 125, 150, 175, 200];

export const SETTINGS_STORAGE_KEY = 'poe-gem-tracker-settings';

/** Loose Tauri global-shortcut shape: Modifier(+Modifier)*+Key */
const HOTKEY_RE =
  /^(?:(?:Ctrl|Control|Alt|Shift|Super|Command|Cmd|Meta|CommandOrControl)\+)+([A-Za-z0-9]+|`|~)$/i;

/** Map UI / keyboard aliases to Tauri Code names. */
const KEY_ALIASES = {
  '`': 'Backquote',
  '~': 'Backquote',
  grave: 'Backquote',
  backtick: 'Backquote',
  backquote: 'Backquote',
};

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Snap a scale percent to the nearest SCALE_STEPS value. */
export function snapScale(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.scale;
  let best = SCALE_STEPS[0];
  let bestDist = Math.abs(n - best);
  for (let i = 1; i < SCALE_STEPS.length; i += 1) {
    const step = SCALE_STEPS[i];
    const dist = Math.abs(n - step);
    if (dist < bestDist) {
      best = step;
      bestDist = dist;
    }
  }
  return best;
}

/** Move one step along SCALE_STEPS (−1 previous, +1 next). */
export function stepScale(current, direction) {
  const snapped = snapScale(current);
  const idx = SCALE_STEPS.indexOf(snapped);
  const next = clamp(idx + direction, 0, SCALE_STEPS.length - 1);
  return SCALE_STEPS[next];
}

function normalizeKeyToken(key) {
  const alias = KEY_ALIASES[key] ?? KEY_ALIASES[key.toLowerCase()];
  if (alias) return alias;
  if (key.length === 1) return key.toUpperCase();
  return key[0].toUpperCase() + key.slice(1);
}

/** Normalize a hotkey string; return fallback if empty/invalid. */
export function normalizeHotkey(value, fallback) {
  const raw = String(value ?? '')
    .trim()
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, '');
  if (!raw || !HOTKEY_RE.test(raw)) return fallback;

  const parts = raw.split('+');
  const key = parts.pop();
  const mods = parts.map((m) => {
    const lower = m.toLowerCase();
    if (lower === 'ctrl' || lower === 'control') return 'Ctrl';
    if (lower === 'alt') return 'Alt';
    if (lower === 'shift') return 'Shift';
    if (lower === 'super' || lower === 'meta' || lower === 'cmd' || lower === 'command')
      return 'Super';
    if (lower === 'commandorcontrol') return 'CommandOrControl';
    return m[0].toUpperCase() + m.slice(1);
  });
  return [...mods, normalizeKeyToken(key)].join('+');
}

export function dedupeHotkeys(complete, interact) {
  let hotkeyComplete = complete;
  let hotkeyInteract = interact;
  if (hotkeyComplete.toLowerCase() === hotkeyInteract.toLowerCase()) {
    hotkeyInteract = DEFAULT_SETTINGS.hotkeyInteract;
    if (hotkeyComplete.toLowerCase() === hotkeyInteract.toLowerCase()) {
      hotkeyComplete = DEFAULT_SETTINGS.hotkeyComplete;
    }
  }
  return { hotkeyComplete, hotkeyInteract };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw);
    const { hotkeyComplete, hotkeyInteract } = dedupeHotkeys(
      normalizeHotkey(data.hotkeyComplete, DEFAULT_SETTINGS.hotkeyComplete),
      normalizeHotkey(data.hotkeyInteract, DEFAULT_SETTINGS.hotkeyInteract),
    );
    return {
      scale: snapScale(data.scale ?? DEFAULT_SETTINGS.scale),
      width: clamp(Number(data.width) || DEFAULT_SETTINGS.width, 160, 800),
      height: clamp(Number(data.height) || DEFAULT_SETTINGS.height, 200, 1200),
      autoAdvanceSkillSet:
        data.autoAdvanceSkillSet ?? DEFAULT_SETTINGS.autoAdvanceSkillSet,
      showNextUp: data.showNextUp ?? DEFAULT_SETTINGS.showNextUp,
      hideCompletedGems:
        data.hideCompletedGems ?? DEFAULT_SETTINGS.hideCompletedGems,
      hotkeyComplete,
      hotkeyInteract,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

/** Effective outer window size from base width/height × scale%. */
export function effectiveWindowSize(settings) {
  const factor = snapScale(settings.scale) / 100;
  return {
    width: Math.round(clamp(settings.width, 160, 800) * factor),
    height: Math.round(clamp(settings.height, 200, 1200) * factor),
  };
}

/** Next skill set that still has incomplete gems (forward, then wrap). */
export function findNextIncompleteSkillSet(skillSets, currentId, completedMap) {
  if (!skillSets?.length) return currentId;

  const start = Math.max(
    0,
    skillSets.findIndex((s) => s.id === currentId),
  );

  for (let step = 1; step <= skillSets.length; step += 1) {
    const next = skillSets[(start + step) % skillSets.length];
    const hasIncomplete = (next.gems || []).some((g) => !completedMap[g.name]);
    if (hasIncomplete) return next.id;
  }

  return currentId;
}

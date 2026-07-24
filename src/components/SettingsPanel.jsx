import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  dedupeHotkeys,
  normalizeHotkey,
  SCALE_STEPS,
  snapScale,
  stepScale,
} from '../lib/settings';

const MODIFIER_KEYS = new Set([
  'Control',
  'Ctrl',
  'Alt',
  'Shift',
  'Meta',
  'OS',
  'Hyper',
  'Super',
]);

/** Map a KeyboardEvent to the Tauri-style string normalizeHotkey expects, or null. */
function eventToHotkeyString(e) {
  if (MODIFIER_KEYS.has(e.key)) return null;
  if (e.key === 'Escape') return null;

  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (mods.length === 0) return null;

  let key;
  if (e.code === 'Backquote' || e.key === '`' || e.key === '~') {
    // Tauri Code::Backquote — key above Tab on ISO/ANSI QWERTY
    key = 'Backquote';
  } else if (/^Key[A-Z]$/.test(e.code)) {
    key = e.code.slice(3);
  } else if (/^Digit[0-9]$/.test(e.code)) {
    key = e.code.slice(5);
  } else if (/^Numpad[0-9]$/.test(e.code)) {
    key = e.code.slice(6);
  } else if (e.key === ' ') {
    key = 'Space';
  } else if (e.key.length === 1) {
    key = e.key.toUpperCase();
  } else {
    key = e.key;
  }

  return [...mods, key].join('+');
}

function HotkeyCapture({ label, value, listening, onStart }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] text-amber-200/70">{label}</span>
      <button
        type="button"
        onClick={onStart}
        aria-pressed={listening}
        className={[
          'w-full rounded-md border px-2 py-1 text-xs text-left transition outline-none',
          listening
            ? 'bg-amber-500/20 border-amber-400/60 text-amber-100 ring-1 ring-amber-400/40'
            : 'bg-slate-900/80 border-amber-500/25 text-amber-50 hover:border-amber-400/50 focus:border-amber-400/60',
        ].join(' ')}
      >
        {listening ? 'Press keys…' : value || 'Click to bind'}
      </button>
    </label>
  );
}

/**
 * Settings panel: PoB import + overlay preferences.
 */
export default function SettingsPanel({
  settings,
  onChange,
  onClose,
  input,
  onInputChange,
  onImport,
  loading = false,
  error = '',
  className = null,
  hasBuild = false,
  onHotkeyListeningChange,
  onQuit,
}) {
  /** @type {null | 'hotkeyComplete' | 'hotkeyInteract' | 'hotkeyOverlayToggle'} */
  const [listening, setListening] = useState(null);
  const [captureHint, setCaptureHint] = useState('');
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** Combo snapped on keydown; committed on non-modifier keyup. */
  const pendingHotkeyRef = useRef(null);
  const listeningRef = useRef(listening);
  listeningRef.current = listening;

  function update(partial) {
    onChange({ ...settings, ...partial });
  }

  function commitHotkeys(partial, base = settings) {
    const { hotkeyComplete, hotkeyInteract, hotkeyOverlayToggle } =
      dedupeHotkeys(
        normalizeHotkey(
          partial.hotkeyComplete ?? base.hotkeyComplete,
          DEFAULT_SETTINGS.hotkeyComplete,
        ),
        normalizeHotkey(
          partial.hotkeyInteract ?? base.hotkeyInteract,
          DEFAULT_SETTINGS.hotkeyInteract,
        ),
        normalizeHotkey(
          partial.hotkeyOverlayToggle ?? base.hotkeyOverlayToggle,
          DEFAULT_SETTINGS.hotkeyOverlayToggle,
        ),
      );
    onChange({
      ...base,
      hotkeyComplete,
      hotkeyInteract,
      hotkeyOverlayToggle,
    });
  }

  const stopListening = useCallback(() => {
    pendingHotkeyRef.current = null;
    setCaptureHint('');
    setListening(null);
  }, []);

  // Tell App to unregister/re-register global shortcuts; always clear on unmount.
  useEffect(() => {
    if (listening) {
      onHotkeyListeningChange?.(true);
      return () => {
        onHotkeyListeningChange?.(false);
      };
    }
    onHotkeyListeningChange?.(false);
    return undefined;
  }, [listening, onHotkeyListeningChange]);

  useEffect(() => {
    if (!listening) return undefined;

    let idleTimer = null;
    const resetIdle = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        stopListening();
      }, 5000);
    };
    resetIdle();

    function onKeyDown(e) {
      e.preventDefault();
      e.stopPropagation();
      resetIdle();

      if (e.key === 'Escape') {
        stopListening();
        return;
      }

      if (MODIFIER_KEYS.has(e.key)) {
        return;
      }

      const hotkey = eventToHotkeyString(e);
      if (!hotkey) {
        pendingHotkeyRef.current = null;
        setCaptureHint('Include a modifier (e.g. Alt+N)');
        return;
      }

      setCaptureHint('');
      pendingHotkeyRef.current = hotkey;
    }

    function onKeyUp(e) {
      e.preventDefault();
      e.stopPropagation();
      resetIdle();

      if (e.key === 'Escape') {
        stopListening();
        return;
      }

      // Commit when the non-modifier key is released (combo was snapped on keydown).
      if (MODIFIER_KEYS.has(e.key)) {
        return;
      }

      const pending = pendingHotkeyRef.current;
      if (!pending) return;

      const field = listeningRef.current;
      pendingHotkeyRef.current = null;
      setCaptureHint('');
      setListening(null);
      if (field) {
        commitHotkeys({ [field]: pending }, settingsRef.current);
      }
    }

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.clearTimeout(idleTimer);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      pendingHotkeyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commit via settingsRef; stopListening stable
  }, [listening, stopListening]);

  function handleSubmit(e) {
    e.preventDefault();
    onImport?.();
  }

  function startListening(field) {
    setCaptureHint('');
    pendingHotkeyRef.current = null;
    setListening((cur) => (cur === field ? null : field));
  }

  const hintComplete = normalizeHotkey(
    settings.hotkeyComplete,
    DEFAULT_SETTINGS.hotkeyComplete,
  );
  const { hotkeyInteract: hintInteract, hotkeyOverlayToggle: hintOverlayToggle } =
    dedupeHotkeys(
      hintComplete,
      normalizeHotkey(settings.hotkeyInteract, DEFAULT_SETTINGS.hotkeyInteract),
      normalizeHotkey(
        settings.hotkeyOverlayToggle,
        DEFAULT_SETTINGS.hotkeyOverlayToggle,
      ),
    );

  return (
    <div className="mx-2 mb-2 px-3 py-2.5 space-y-5 text-amber-100 shadow-lg overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold tracking-wide text-amber-300">
          Settings
        </h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-2">
        <label className="block space-y-1">
          <span className="text-[10px] text-amber-200/70">Import PoB</span>
          <input
            type="text"
            value={input}
            onChange={(e) => onInputChange?.(e.target.value)}
            placeholder="Pastebin / pobb.in / raw PoB code"
            className="w-full rounded-md bg-slate-900/80 border border-amber-500/25 px-2 py-1.5 text-xs text-amber-50 placeholder:text-amber-100/30 outline-none focus:border-amber-400/60"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !input?.trim()}
          className="w-full rounded-md bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 border border-amber-500/40 px-2 py-1.5 text-xs font-medium text-amber-200 transition"
        >
          {loading ? 'Importing…' : 'Import Build'}
        </button>
        {error && (
          <p className="text-[11px] text-red-300/90 leading-snug">{error}</p>
        )}
        {className && (
          <p className="text-[10px] text-amber-100/40">Class: {className}</p>
        )}
      </form>

      <div className="border-t border-amber-500/15 pt-2 space-y-3">
        <div className="space-y-1">
          <span className="text-[10px] text-amber-200/70">UI scale</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease scale"
              disabled={snapScale(settings.scale) <= SCALE_STEPS[0]}
              onClick={() =>
                update({ scale: stepScale(settings.scale, -1) })
              }
              className="rounded-md border border-amber-500/25 bg-slate-900/80 px-2.5 py-1 text-xs text-amber-50 hover:border-amber-400/50 disabled:opacity-35 disabled:hover:border-amber-500/25"
            >
              −
            </button>
            <span className="min-w-[3.25rem] text-center text-xs tabular-nums text-amber-100">
              {snapScale(settings.scale)}%
            </span>
            <button
              type="button"
              aria-label="Increase scale"
              disabled={
                snapScale(settings.scale) >=
                SCALE_STEPS[SCALE_STEPS.length - 1]
              }
              onClick={() => update({ scale: stepScale(settings.scale, 1) })}
              className="rounded-md border border-amber-500/25 bg-slate-900/80 px-2.5 py-1 text-xs text-amber-50 hover:border-amber-400/50 disabled:opacity-35 disabled:hover:border-amber-500/25"
            >
              +
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[10px] text-amber-200/70">Width</span>
            <input
              type="number"
              min={160}
              max={800}
              step={10}
              value={settings.width}
              onChange={(e) =>
                update({
                  width: Number(e.target.value) || DEFAULT_SETTINGS.width,
                })
              }
              className="w-full rounded-md bg-slate-900/80 border border-amber-500/25 px-2 py-1 text-xs text-amber-50 outline-none focus:border-amber-400/60"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-amber-200/70">Height</span>
            <input
              type="number"
              min={200}
              max={1200}
              step={10}
              value={settings.height}
              onChange={(e) =>
                update({
                  height: Number(e.target.value) || DEFAULT_SETTINGS.height,
                })
              }
              className="w-full rounded-md bg-slate-900/80 border border-amber-500/25 px-2 py-1 text-xs text-amber-50 outline-none focus:border-amber-400/60"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <HotkeyCapture
            label="Complete next"
            value={hintComplete}
            listening={listening === 'hotkeyComplete'}
            onStart={() => startListening('hotkeyComplete')}
          />
          <HotkeyCapture
            label="Edit mode"
            value={hintInteract}
            listening={listening === 'hotkeyInteract'}
            onStart={() => startListening('hotkeyInteract')}
          />
          <HotkeyCapture
            label="Hide / show overlay"
            value={hintOverlayToggle}
            listening={listening === 'hotkeyOverlayToggle'}
            onStart={() => startListening('hotkeyOverlayToggle')}
          />
        </div>
        <p className="text-[9px] text-amber-100/35 leading-snug">
          Click a field, hold a shortcut, then release (e.g. Alt+N). Esc or 5s
          idle cancels.
        </p>
        {captureHint && (
          <p className="text-[10px] text-amber-300/90 leading-snug">{captureHint}</p>
        )}

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!settings.autoAdvanceSkillSet}
            onChange={(e) => update({ autoAdvanceSkillSet: e.target.checked })}
            className="mt-0.5 accent-amber-400"
          />
          <span className="text-[11px] text-amber-100/80 leading-snug">
            Auto-advance skill set
            <span className="block text-[10px] text-amber-100/40 mt-0.5">
              When every gem in the current set is done, switch to the next set.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.showNextUp !== false}
            onChange={(e) => update({ showNextUp: e.target.checked })}
            className="mt-0.5 accent-amber-400"
          />
          <span className="text-[11px] text-amber-100/80 leading-snug">
            Show next up
            <span className="block text-[10px] text-amber-100/40 mt-0.5">
              Highlight the next incomplete gem above the list.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!settings.hideCompletedGems}
            onChange={(e) => update({ hideCompletedGems: e.target.checked })}
            className="mt-0.5 accent-amber-400"
          />
          <span className="text-[11px] text-amber-100/80 leading-snug">
            Hide completed gems
            <span className="block text-[10px] text-amber-100/40 mt-0.5">
              Remove finished gems from the list until unchecked.
            </span>
          </span>
        </label>
      </div>

      <p className="text-[10px] text-amber-100/35 leading-snug">
        {hasBuild
          ? `${hintInteract} to interact · click outside to lock · ${hintComplete} completes next · ${hintOverlayToggle} hides overlay.`
          : 'Import a PoB build to start tracking gems.'}
      </p>

      <div className="border-t border-amber-500/15 pt-3">
        <button
          type="button"
          onClick={() => onQuit?.()}
          className="w-full rounded-md border border-red-500/35 bg-red-950/30 hover:bg-red-950/50 px-2 py-1.5 text-xs font-medium text-red-200/90 transition"
        >
          Quit
        </button>
      </div>
    </div>
  );
}

export function CogIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

export function MoveIcon({ className = 'h-3.5 w-3.5' }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M5 9l-3 3 3 3" />
      <path d="M9 5l3-3 3 3" />
      <path d="M15 19l-3 3-3-3" />
      <path d="M19 9l3 3-3 3" />
      <path d="M2 12h20" />
      <path d="M12 2v20" />
    </svg>
  );
}

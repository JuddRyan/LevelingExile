import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parsePoBImport } from './lib/pobParser';
import { compareEnrichedGems, enrichGem } from './data/gemLookup';
import {
  clamp,
  DEFAULT_SETTINGS,
  effectiveWindowSize,
  findNextIncompleteSkillSet,
  loadSettings,
  normalizeHotkey,
  dedupeHotkeys,
  saveSettings,
  snapScale,
} from './lib/settings';
import SettingsPanel, { CogIcon, MoveIcon } from './components/SettingsPanel';
import GemIcon from './components/GemIcon';
import GemLinksPanel from './components/GemLinksPanel';
import SkillSetSelect from './components/SkillSetSelect';

const STORAGE_KEY = 'poe-gem-tracker-state';
/** Extra CSS width (pre-zoom) added to the right when gem links are open. */
const LINKS_PANEL_WIDTH = 200;

function reenrichSkillSets(skillSets, className) {
  return (skillSets || []).map((set) => ({
    ...set,
    // Preserve PoB socket groups — do not re-sort by campaign act order.
    links: Array.isArray(set.links) ? set.links : [],
    gems: (set.gems || [])
      .map((g) => ({
        ...enrichGem(g.name, className),
        count: Number(g.count) > 1 ? Number(g.count) : 1,
      }))
      .sort(compareEnrichedGems),
  }));
}

/** First skill set that has at least one gem; otherwise first set / null. */
function firstSkillSetId(skillSets) {
  if (!skillSets?.length) return null;
  const withGems = skillSets.find((s) => (s.gems || []).length > 0);
  return (withGems || skillSets[0]).id;
}

function gemActLabel(gem) {
  if (!Number.isFinite(Number(gem?.act))) return null;
  return `Act ${gem.act}`;
}

function gemSourceLine(gem) {
  if (gem?.vendorItem) return `L${gem.level} · vendor item`;
  const parts = [`L${gem.level}`];
  if (gem.quest) parts.push(gem.quest);
  if (gem.vendor) parts.push(gem.vendor);
  return parts.join(' · ');
}

function loadPersisted() {
  const empty = {
    skillSets: [],
    selectedSkillSetId: null,
    className: null,
    completed: {},
    input: '',
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const data = JSON.parse(raw);
    const className = data.className || null;

    let skillSets = data.skillSets || [];
    if ((!skillSets.length) && Array.isArray(data.gems) && data.gems.length) {
      skillSets = [
        {
          id: 'default',
          title: 'Default',
          gems: data.gems,
        },
      ];
    }
    skillSets = reenrichSkillSets(skillSets, className);

    const savedId = data.selectedSkillSetId;
    const savedOk = skillSets.some(
      (s) => s.id === savedId && (s.gems || []).length > 0,
    );
    const selectedSkillSetId = savedOk ? savedId : firstSkillSetId(skillSets);

    return {
      skillSets,
      selectedSkillSetId,
      className,
      completed: data.completed || {},
      input: data.input || '',
    };
  } catch {
    return empty;
  }
}

async function getAppWindow() {
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow();
}

async function ensureAlwaysOnTop() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('force_always_on_top');
  } catch {
    try {
      const win = await getAppWindow();
      await win.setAlwaysOnTop(true);
    } catch {
      // browser
    }
  }
}

async function setTopmostPaused(paused) {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('set_topmost_paused', { paused });
  } catch {
    // browser / older build
  }
}

async function exitApp() {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('exit_app');
  } catch {
    try {
      const win = await getAppWindow();
      await win.close();
    } catch {
      // browser
    }
  }
}

async function applyWindowLayout(settings, extraCssWidth = 0) {
  try {
    const { LogicalSize } = await import('@tauri-apps/api/dpi');
    const win = await getAppWindow();
    await win.setAlwaysOnTop(true);

    const { width, height } = effectiveWindowSize(settings);
    const factor = snapScale(settings.scale) / 100;
    const extra = Math.max(0, Number(extraCssWidth) || 0);
    await win.setSize(
      new LogicalSize(width + Math.round(extra * factor), height),
    );
  } catch {
    // browser
  }
}

export default function App() {
  const persisted = useRef(loadPersisted()).current;
  const [input, setInput] = useState(persisted.input || '');
  const [skillSets, setSkillSets] = useState(persisted.skillSets || []);
  const [selectedSkillSetId, setSelectedSkillSetId] = useState(
    persisted.selectedSkillSetId || null,
  );
  const [className, setClassName] = useState(persisted.className || null);
  const [completed, setCompleted] = useState(persisted.completed || {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hotkeyReady, setHotkeyReady] = useState(false);
  const [hotkeyListening, setHotkeyListening] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(
    () => !(persisted.skillSets || []).some((s) => s.gems?.length),
  );
  const [interactive, setInteractive] = useState(
    () => !(persisted.skillSets || []).some((s) => s.gems?.length),
  );
  const [moveMode, setMoveMode] = useState(false);
  const [settings, setSettings] = useState(() => loadSettings());
  const [gemLinksOpen, setGemLinksOpen] = useState(false);

  const selectedSkillSet = useMemo(
    () => skillSets.find((s) => s.id === selectedSkillSetId) || null,
    [skillSets, selectedSkillSetId],
  );

  const gems = useMemo(
    () => selectedSkillSet?.gems || [],
    [selectedSkillSet],
  );

  const gemLinks = useMemo(
    () => selectedSkillSet?.links || [],
    [selectedSkillSet],
  );

  const hasBuild = gems.length > 0 || skillSets.some((s) => s.gems?.length);
  const overlayMode = hasBuild && !settingsOpen;
  const showGemLinks = gemLinksOpen && hasBuild && !settingsOpen;
  const clickThrough = hasBuild && !settingsOpen && !interactive;
  // No build / settings open: always usable; otherwise only after interact hotkey
  const uiInteractive = !hasBuild || settingsOpen || interactive;
  const hotkeyComplete = normalizeHotkey(
    settings.hotkeyComplete,
    DEFAULT_SETTINGS.hotkeyComplete,
  );
  const hotkeyInteract = dedupeHotkeys(
    hotkeyComplete,
    normalizeHotkey(settings.hotkeyInteract, DEFAULT_SETTINGS.hotkeyInteract),
  ).hotkeyInteract;
  const dragAttrs = moveMode ? { 'data-tauri-drag-region': true } : {};

  const completedRef = useRef(completed);
  const gemsRef = useRef(gems);
  /** Skip lock-on-blur while dragging via data-tauri-drag-region (OS drag steals focus). */
  const suppressBlurLockRef = useRef(false);

  useEffect(() => {
    completedRef.current = completed;
    gemsRef.current = gems;
  }, [completed, gems]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        skillSets,
        selectedSkillSetId,
        className,
        completed,
        input,
      }),
    );
  }, [skillSets, selectedSkillSetId, className, completed, input]);

  // Persist all settings; resize window only when size/scale change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyWindowLayout(settings, showGemLinks ? LINKS_PANEL_WIDTH : 0);
  }, [settings.scale, settings.width, settings.height, showGemLinks]);

  // Startup: always on top + apply size
  useEffect(() => {
    const initial = loadSettings();
    applyWindowLayout(initial, 0);
    ensureAlwaysOnTop();
  }, []);

  // Drop links panel when there is no build to show
  useEffect(() => {
    if (!hasBuild) setGemLinksOpen(false);
  }, [hasBuild]);

  // Move mode off each time edit mode is entered (and when locked)
  useEffect(() => {
    setMoveMode(false);
  }, [interactive]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const win = await getAppWindow();
        if (cancelled) return;
        await win.setIgnoreCursorEvents(clickThrough);
        if (!clickThrough) await win.setAlwaysOnTop(true);
      } catch {
        // Browser / unsupported
      }
    })();
    return () => {
      cancelled = true;
      getAppWindow()
        .then((win) => win.setIgnoreCursorEvents(false))
        .catch(() => {});
    };
  }, [clickThrough]);

  // Close menus when overlay locks again
  useEffect(() => {
    if (clickThrough) {
      setSettingsOpen(false);
    }
  }, [clickThrough]);

  // Header drag (data-tauri-drag-region) steals focus; suppress lock until drag ends.
  useEffect(() => {
    let clearTimer = null;
    const onPointerDown = (e) => {
      if (!moveMode) return;
      if (e.target?.closest?.('[data-tauri-drag-region]')) {
        clearTimeout(clearTimer);
        suppressBlurLockRef.current = true;
      }
    };
    // Delay clear so a drag's blur can run first; skip clear if focus already lost.
    const clearIfFocused = () => {
      clearTimeout(clearTimer);
      clearTimer = setTimeout(() => {
        if (document.hasFocus()) suppressBlurLockRef.current = false;
      }, 100);
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointerup', clearIfFocused, true);
    window.addEventListener('pointercancel', clearIfFocused, true);
    return () => {
      clearTimeout(clearTimer);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('pointerup', clearIfFocused, true);
      window.removeEventListener('pointercancel', clearIfFocused, true);
    };
  }, [moveMode]);

  useEffect(() => {
    let unlisten = null;
    let cancelled = false;

    (async () => {
      try {
        const win = await getAppWindow();
        if (cancelled) return;
        unlisten = await win.onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            if (suppressBlurLockRef.current) return;
            setInteractive(false);
            setTopmostPaused(false);
            ensureAlwaysOnTop();
          } else {
            suppressBlurLockRef.current = false;
            setTopmostPaused(true);
          }
        });
      } catch {
        const onBlur = () => {
          if (suppressBlurLockRef.current) return;
          setInteractive(false);
        };
        const onFocus = () => {
          suppressBlurLockRef.current = false;
        };
        window.addEventListener('blur', onBlur);
        window.addEventListener('focus', onFocus);
        unlisten = () => {
          window.removeEventListener('blur', onBlur);
          window.removeEventListener('focus', onFocus);
        };
      }
    })();

    return () => {
      cancelled = true;
      if (typeof unlisten === 'function') unlisten();
    };
  }, []);

  const unlockInteractive = useCallback(async () => {
    setInteractive(true);
    await setTopmostPaused(true);
    try {
      const win = await getAppWindow();
      await win.setIgnoreCursorEvents(false);
      await win.setAlwaysOnTop(true);
      await win.setFocus();
    } catch {
      // ignore
    }
  }, []);

  const unlockInteractiveRef = useRef(unlockInteractive);
  useEffect(() => {
    unlockInteractiveRef.current = unlockInteractive;
  }, [unlockInteractive]);

  const orderedGems = useMemo(() => {
    return [...gems].sort((a, b) => {
      const aDone = completed[a.name] ? 1 : 0;
      const bDone = completed[b.name] ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone; // incomplete first, completed at bottom
      return compareEnrichedGems(a, b);
    });
  }, [gems, completed]);

  const nextUp = useMemo(
    () => orderedGems.find((g) => !completed[g.name]) || null,
    [orderedGems, completed],
  );

  // Auto-advance to next skill set when current list is fully completed
  useEffect(() => {
    if (!settings.autoAdvanceSkillSet) return;
    if (!gems.length || skillSets.length < 2) return;
    const allDone = gems.every((g) => completed[g.name]);
    if (!allDone) return;

    const nextId = findNextIncompleteSkillSet(
      skillSets,
      selectedSkillSetId,
      completed,
    );
    if (nextId && nextId !== selectedSkillSetId) {
      setSelectedSkillSetId(nextId);
    }
  }, [
    completed,
    gems,
    skillSets,
    selectedSkillSetId,
    settings.autoAdvanceSkillSet,
  ]);

  const toggleGem = useCallback((name) => {
    setCompleted((prev) => ({
      ...prev,
      [name]: !prev[name],
    }));
  }, []);

  const completeNext = useCallback(() => {
    const list = gemsRef.current;
    const done = completedRef.current;
    const next = [...list]
      .sort((a, b) => {
        const aDone = done[a.name] ? 1 : 0;
        const bDone = done[b.name] ? 1 : 0;
        if (aDone !== bDone) return aDone - bDone;
        return compareEnrichedGems(a, b);
      })
      .find((g) => !done[g.name]);
    if (!next) return;
    setCompleted((prev) => ({ ...prev, [next.name]: true }));
  }, []);

  const completeNextRef = useRef(completeNext);
  useEffect(() => {
    completeNextRef.current = completeNext;
  }, [completeNext]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFn = null;

    async function setupHotkeys() {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const { listen } = await import('@tauri-apps/api/event');

        // Pause while Settings is capturing a new binding.
        if (hotkeyListening) {
          await invoke('set_game_hotkeys', { complete: null, interact: null });
          if (!cancelled) setHotkeyReady(false);
          return;
        }

        await invoke('set_game_hotkeys', {
          complete: hotkeyComplete,
          interact:
            hotkeyInteract === hotkeyComplete ? null : hotkeyInteract,
        });
        if (cancelled) return;

        const stop = await listen('game-hotkey', (event) => {
          if (event.payload === 'complete') completeNextRef.current();
          else if (event.payload === 'interact') unlockInteractiveRef.current();
        });
        if (cancelled) {
          stop();
          return;
        }
        unlistenFn = stop;

        setHotkeyReady(true);
      } catch {
        if (!cancelled) setHotkeyReady(false);
      }
    }

    setupHotkeys();

    return () => {
      cancelled = true;
      unlistenFn?.();
      import('@tauri-apps/api/core')
        .then(({ invoke }) =>
          invoke('set_game_hotkeys', { complete: null, interact: null }),
        )
        .catch(() => {});
    };
  }, [hotkeyComplete, hotkeyInteract, hotkeyListening]);

  const onHotkeyListeningChange = useCallback((listening) => {
    setHotkeyListening(!!listening);
  }, []);

  function handleSettingsChange(next) {
    setSettings({
      ...next,
      scale: snapScale(next.scale ?? DEFAULT_SETTINGS.scale),
      width: clamp(Number(next.width) || 320, 160, 800),
      height: clamp(Number(next.height) || 450, 200, 1200),
      autoAdvanceSkillSet: !!next.autoAdvanceSkillSet,
      showNextUp: next.showNextUp !== false,
      hideCompletedGems: !!next.hideCompletedGems,
      hotkeyComplete: String(next.hotkeyComplete ?? ''),
      hotkeyInteract: String(next.hotkeyInteract ?? ''),
    });
  }

  async function handleImport() {
    setError('');
    setLoading(true);
    try {
      const parsed = await parsePoBImport(input);
      setSkillSets(parsed.skillSets);
      setSelectedSkillSetId(firstSkillSetId(parsed.skillSets));
      setClassName(parsed.className);
      setCompleted({});
      setSettingsOpen(false);
      setInteractive(false);
      await ensureAlwaysOnTop();
    } catch (err) {
      setError(err?.message || 'Failed to import PoB build.');
    } finally {
      setLoading(false);
    }
  }

  function handleSkillSetChange(id) {
    setSelectedSkillSetId(id);
  }

  // If selection is missing from the list, fall back to the first set with gems.
  useEffect(() => {
    if (!skillSets.length) return;
    if (skillSets.some((s) => s.id === selectedSkillSetId)) return;
    const nextId = firstSkillSetId(skillSets);
    if (nextId) setSelectedSkillSetId(nextId);
  }, [skillSets, selectedSkillSetId]);

  const doneCount = orderedGems.filter((g) => completed[g.name]).length;
  const visibleGems = settings.hideCompletedGems
    ? orderedGems.filter((g) => !completed[g.name])
    : orderedGems;
  const textShadow = '0 1px 2px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.7)';
  const scaleFactor = snapScale(settings.scale) / 100;
  const shellWidth =
    settings.width + (showGemLinks ? LINKS_PANEL_WIDTH : 0);

  return (
    <div className="h-screen w-screen overflow-hidden bg-transparent">
      <div
        className="flex flex-row select-none text-amber-100 overflow-hidden"
        style={{
          width: shellWidth,
          height: settings.height,
          zoom: scaleFactor,
          pointerEvents: clickThrough ? 'none' : 'auto',
        }}
      >
      <div
        className={[
          'flex flex-col overflow-hidden shrink-0',
          overlayMode
            ? interactive
              ? 'rounded-md border border-amber-400/55 bg-slate-950/35'
              : 'bg-transparent'
            : 'bg-slate-900/85 backdrop-blur-md border border-amber-500/30 shadow-2xl rounded-md',
        ].join(' ')}
        style={{
          width: settings.width,
          height: settings.height,
        }}
      >
      {(hasBuild || uiInteractive) && (
        <div
          {...(uiInteractive ? dragAttrs : {})}
          className={[
            'flex items-center justify-between gap-2 px-2 py-1.5 shrink-0',
            uiInteractive ? '' : 'invisible pointer-events-none',
            overlayMode ? 'bg-transparent' : 'border-b border-amber-500/20',
          ].join(' ')}
          aria-hidden={!uiInteractive}
        >
          <div
            {...(uiInteractive ? dragAttrs : {})}
            className="flex items-center gap-2 min-w-0"
          >
            <span
              {...(uiInteractive ? dragAttrs : {})}
              className="text-[10px] font-semibold text-amber-200/90"
              style={hasBuild ? { textShadow } : undefined}
            >
              {hasBuild
                ? `${doneCount}/${orderedGems.length}${
                    hotkeyReady
                      ? ` · ${hotkeyComplete} next · ${hotkeyInteract} edit`
                      : ''
                  }${interactive ? ' · interactive' : ''}${
                    moveMode ? ' · move' : ''
                  }`
                : 'LevelingExile'}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              title={moveMode ? 'Move mode on — drag header' : 'Move window'}
              aria-label="Move window"
              aria-pressed={moveMode}
              onClick={() => setMoveMode((v) => !v)}
              className={[
                'rounded p-1 border transition inline-flex items-center justify-center',
                moveMode
                  ? 'border-amber-400/50 text-amber-100 bg-amber-500/20'
                  : 'border-amber-500/30 text-amber-100/80 bg-black/35 hover:bg-black/50',
              ].join(' ')}
              style={hasBuild ? { textShadow } : undefined}
            >
              <MoveIcon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Settings"
              aria-label="Settings"
              onClick={() => {
                setSettingsOpen((v) => {
                  const next = !v;
                  if (next && !hasBuild) setInteractive(true);
                  return next;
                });
              }}
              className={[
                'rounded p-1 border transition inline-flex items-center justify-center',
                settingsOpen
                  ? 'border-amber-400/50 text-amber-100 bg-amber-500/20'
                  : 'border-amber-500/30 text-amber-100/80 bg-black/35 hover:bg-black/50',
              ].join(' ')}
              style={hasBuild ? { textShadow } : undefined}
            >
              <CogIcon className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onChange={handleSettingsChange}
          onClose={() => setSettingsOpen(false)}
          input={input}
          onInputChange={setInput}
          onImport={handleImport}
          loading={loading}
          error={error}
          className={className}
          hasBuild={hasBuild}
          onHotkeyListeningChange={onHotkeyListeningChange}
          onQuit={exitApp}
        />
      )}
      {!settingsOpen && (
        <>
          {(hasBuild || uiInteractive) && skillSets.length > 0 && (
            <div className="relative z-50 px-2 pb-1.5 shrink-0 flex items-stretch gap-1.5">
              <div className="min-w-0 flex-1">
                <SkillSetSelect
                  skillSets={skillSets}
                  value={selectedSkillSetId}
                  onChange={handleSkillSetChange}
                  overlay={overlayMode}
                  textShadow={textShadow}
                  enabled={uiInteractive}
                />
              </div>
              {hasBuild && (
                <button
                  type="button"
                  title={
                    gemLinksOpen ? 'Hide gem links' : 'Show gem links'
                  }
                  aria-label={
                    gemLinksOpen ? 'Hide gem links' : 'Show gem links'
                  }
                  aria-pressed={gemLinksOpen}
                  disabled={!uiInteractive}
                  onClick={() => setGemLinksOpen((v) => !v)}
                  className={[
                    'shrink-0 rounded-md px-2 text-[10px] font-semibold border transition',
                    gemLinksOpen
                      ? 'border-amber-400/50 text-amber-100 bg-amber-500/20'
                      : overlayMode
                        ? 'border-white/15 text-amber-100/85 bg-black/45 hover:bg-black/60'
                        : 'border-amber-500/25 text-amber-100/85 bg-slate-950/70 hover:border-amber-400/50',
                    uiInteractive ? '' : 'opacity-80',
                  ].join(' ')}
                  style={overlayMode ? { textShadow } : undefined}
                >
                  Links
                </button>
              )}
            </div>
          )}

          {settings.showNextUp && nextUp && (
            <section
              className={[
                'mx-2 mb-1.5 rounded-md px-2.5 py-2',
                overlayMode
                  ? 'bg-black/50 border border-amber-400/35'
                  : 'bg-amber-500/15 border border-amber-400/50',
              ].join(' ')}
            >
              <div className="flex items-center gap-2.5">
                <GemIcon
                  name={nextUp.name}
                  overlay={overlayMode}
                  className="h-[68px] w-[68px] shrink-0"
                />
                <div className="min-w-0 flex-1 text-left">
                  <p
                    className="text-[8px] uppercase tracking-[0.16em] text-amber-300/90"
                    style={overlayMode ? { textShadow } : undefined}
                  >
                    Next up
                  </p>
                  {Number.isFinite(Number(nextUp.act)) && (
                    <p
                      className="text-xs font-bold text-amber-300 leading-tight"
                      style={overlayMode ? { textShadow } : undefined}
                    >
                      Act {nextUp.act}
                    </p>
                  )}
                  <p
                    className="mt-0.5 text-sm font-semibold text-amber-50 leading-snug"
                    style={overlayMode ? { textShadow } : undefined}
                  >
                    {nextUp.name}
                    {(nextUp.count ?? 1) > 1 && (
                      <span className="ml-1.5 text-[11px] font-bold text-amber-300/95">
                        {nextUp.count}x
                      </span>
                    )}
                  </p>
                  <div
                    className="mt-1 space-y-0 text-[11px] text-amber-100/95 leading-snug"
                    style={overlayMode ? { textShadow } : undefined}
                  >
                    <p>Level {nextUp.level}</p>
                    {nextUp.vendorItem ? (
                      <p>vendor item</p>
                    ) : (
                      <>
                        {nextUp.quest && <p>{nextUp.quest}</p>}
                        {nextUp.vendor && (
                          <p className="text-amber-200/90">{nextUp.vendor}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {settings.showNextUp && !nextUp && orderedGems.length > 0 && (
            <section
              className={[
                'mx-2 mb-1.5 rounded-md px-3 py-2 text-center text-xs font-medium',
                overlayMode
                  ? 'bg-black/45 border border-emerald-400/30 text-emerald-200'
                  : 'bg-emerald-500/10 border border-emerald-400/30 text-emerald-200',
              ].join(' ')}
              style={overlayMode ? { textShadow } : undefined}
            >
              All gems completed
            </section>
          )}

          <ul className="relative z-0 flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {orderedGems.length === 0 && (
              <li className="px-2 py-6 text-center text-xs text-amber-100/40">
                Open settings (cog) to import a PoB build.
              </li>
            )}

            {orderedGems.length > 0 && visibleGems.length === 0 && (
              <li className="px-2 py-6 text-center text-xs text-amber-100/40">
                All gems in this set are completed.
              </li>
            )}

            {visibleGems.map((gem) => {
              const isDone = !!completed[gem.name];
              const isNext = nextUp?.name === gem.name;
              const actLabel = gemActLabel(gem);
              return (
                <li key={gem.name}>
                  <button
                    type="button"
                    onClick={() => toggleGem(gem.name)}
                    className={[
                      'w-full text-left rounded-md px-2 py-1.5 transition-all duration-200 border',
                      overlayMode
                        ? isDone
                          ? 'opacity-35 bg-transparent border-transparent'
                          : isNext
                            ? 'bg-black/55 border-amber-400/40'
                            : 'bg-black/40 border-white/10 hover:bg-black/55'
                        : isDone
                          ? 'opacity-40 scale-[0.97] border-amber-500/10 bg-slate-950/30'
                          : isNext
                            ? 'border-amber-400/45 bg-amber-500/10'
                            : 'border-amber-500/15 bg-slate-950/40 hover:border-amber-500/35',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <GemIcon
                          name={gem.name}
                          overlay={overlayMode}
                          className="h-6 w-6"
                        />
                        <p
                          className={[
                            'text-xs font-medium min-w-0',
                            isDone ? 'line-through text-amber-100/70' : 'text-amber-50',
                          ].join(' ')}
                          style={overlayMode ? { textShadow } : undefined}
                        >
                          {gem.name}
                          {(gem.count ?? 1) > 1 && (
                            <span
                              className={[
                                'ml-1.5 text-[10px] font-bold no-underline',
                                isDone ? 'text-amber-200/60' : 'text-amber-300',
                              ].join(' ')}
                            >
                              {gem.count}x
                            </span>
                          )}
                        </p>
                      </div>
                      {actLabel && (
                        <span
                          className="shrink-0 text-[10px] font-semibold text-amber-300"
                          style={overlayMode ? { textShadow } : undefined}
                        >
                          {actLabel}
                        </span>
                      )}
                    </div>
                    <p
                      className="mt-0.5 text-[10px] text-amber-100/80 pl-8"
                      style={overlayMode ? { textShadow } : undefined}
                    >
                      {gemSourceLine(gem)}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      </div>

      {showGemLinks && (
        <GemLinksPanel
          links={gemLinks}
          onClose={() => setGemLinksOpen(false)}
          overlay={overlayMode}
          interactive={interactive}
          textShadow={textShadow}
          enabled={uiInteractive}
        />
      )}
      </div>
    </div>
  );
}

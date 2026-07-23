import { useEffect, useRef, useState } from 'react';

/**
 * Custom skill-set dropdown — native <select> popups get buried by
 * always-on-top Win32 refreshes / overflow stacking in the overlay.
 *
 * Pass enabled=false while overlay is locked (click-through) so it
 * cannot be opened without Alt+B.
 */
export default function SkillSetSelect({
  skillSets,
  value,
  onChange,
  overlay = false,
  textShadow,
  enabled = true,
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  const selected =
    skillSets.find((s) => s.id === value) || skillSets[0] || null;

  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(e) {
      if (!rootRef.current?.contains(e.target)) {
        setOpen(false);
      }
    }

    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={[
        'relative z-50',
        enabled ? '' : 'pointer-events-none',
      ].join(' ')}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!enabled}
        onClick={() => {
          if (!enabled) return;
          setOpen((v) => !v);
        }}
        className={[
          'w-full rounded-md px-2 py-1.5 text-xs outline-none text-left flex items-center justify-between gap-2',
          overlay
            ? 'bg-black/45 border border-white/15 text-amber-50'
            : 'bg-slate-950/70 border border-amber-500/25 text-amber-50 focus:border-amber-400/60',
          enabled ? '' : 'opacity-80',
        ].join(' ')}
        style={overlay ? { textShadow } : undefined}
      >
        <span className="truncate">
          {selected
            ? `${selected.title} (${selected.gems.length})`
            : 'Select skill set'}
        </span>
        {enabled && (
          <span className="shrink-0 text-amber-200/60 text-[10px]">
            {open ? '▲' : '▼'}
          </span>
        )}
      </button>

      {open && enabled && (
        <ul
          role="listbox"
          className={[
            'absolute left-0 right-0 top-full mt-1 max-h-48 overflow-y-auto rounded-md border shadow-xl z-[100]',
            overlay
              ? 'bg-black/90 border-white/20'
              : 'bg-slate-950 border-amber-500/30',
          ].join(' ')}
        >
          {skillSets.map((set) => {
            const isActive = set.id === value;
            return (
              <li key={set.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => {
                    onChange(set.id);
                    setOpen(false);
                  }}
                  className={[
                    'w-full text-left px-2.5 py-1.5 text-xs transition',
                    isActive
                      ? 'bg-amber-500/25 text-amber-50'
                      : 'text-amber-100/85 hover:bg-amber-500/15',
                  ].join(' ')}
                  style={overlay ? { textShadow } : undefined}
                >
                  {set.title} ({set.gems.length})
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

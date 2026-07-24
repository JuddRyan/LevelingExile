import { getGemPrimaryAttr } from '../data/gemLookup';

/** Tailwind text colour by gem primary_attr (readable on transparent overlay). */
const ATTR_TEXT_CLASS = {
  str: 'text-red-400',
  dex: 'text-emerald-400',
  int: 'text-sky-400',
};

function gemNameClass(name) {
  const attr = getGemPrimaryAttr(name);
  return ATTR_TEXT_CLASS[attr] || 'text-amber-50';
}

/**
 * Right-side gem-links panel.
 * Uses `display: contents` so header + list sit in the parent App grid
 * (row 1 with move/settings, row 2 with skill-set / Links).
 */
export default function GemLinksPanel({
  links = [],
  onClose,
  overlay = false,
  interactive = false,
  textShadow,
  enabled = true,
}) {
  const hasLinks = Array.isArray(links) && links.length > 0;
  const locked = overlay && !interactive;
  const showChrome = !overlay || interactive;
  const useShadow = overlay ? { textShadow } : undefined;

  const shell = locked
    ? 'bg-transparent border-transparent'
    : overlay
      ? 'bg-slate-950/35 border-amber-400/55'
      : 'bg-slate-950/95 border-amber-500/35';

  const rowClass = overlay
    ? 'bg-black/40 border border-white/10'
    : 'bg-slate-900/80 border border-amber-500/20';

  const closeClass = overlay
    ? 'border-amber-400/40 text-amber-100/85 bg-black/40 hover:bg-black/60'
    : 'border-amber-500/35 text-amber-100/85 bg-black/35 hover:bg-black/50';

  return (
    <aside className="contents" aria-label="Gem links">
      {/* Grid row 1 — beside main header */}
      <div
        className={[
          'min-h-0 flex items-center justify-between gap-1 px-2 py-1.5 border-t border-x rounded-t-md',
          shell,
          !overlay && showChrome ? 'border-b border-amber-500/25' : 'border-b-0',
          showChrome ? '' : 'invisible',
          enabled ? '' : 'pointer-events-none',
        ].join(' ')}
        style={{ gridColumn: 2, gridRow: 1 }}
        aria-hidden={!showChrome}
      >
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200/95"
          style={useShadow}
        >
          Gem links
        </p>
        <button
          type="button"
          title="Close gem links"
          aria-label="Close gem links"
          disabled={!enabled}
          onClick={onClose}
          className={[
            'rounded p-1 border transition inline-flex items-center justify-center',
            closeClass,
            enabled ? '' : 'opacity-60',
          ].join(' ')}
          style={useShadow}
        >
          <span className="h-3.5 w-3.5 text-[10px] leading-none flex items-center justify-center">
            ✕
          </span>
        </button>
      </div>

      {/* Grid row 2 — beside skill-set / Links */}
      <div
        className={[
          'min-h-0 flex flex-col overflow-hidden border-x border-b rounded-b-md',
          shell,
          enabled ? '' : 'pointer-events-none',
        ].join(' ')}
        style={{ gridColumn: 2, gridRow: 2 }}
      >
        <ul className="flex-1 overflow-y-auto px-2 pt-0 pb-1.5 space-y-1.5">
          {!hasLinks && (
            <li
              className="py-4 text-center text-[11px] text-amber-100/45 leading-snug"
              style={useShadow}
            >
              No gem links in this skill set.
            </li>
          )}

          {hasLinks &&
            links.map((link, index) => {
              const gems = link?.gems || [];
              const key = `${index}-${gems.join('|')}`;
              return (
                <li
                  key={key}
                  className={[
                    'rounded-md px-2 py-1.5 text-[11px] leading-snug',
                    rowClass,
                  ].join(' ')}
                >
                  {gems.map((name, gemIndex) => (
                    <span key={`${gemIndex}-${name}`}>
                      {gemIndex > 0 && (
                        <span className="text-amber-50" style={useShadow}>
                          {' - '}
                        </span>
                      )}
                      <span
                        className={`${gemNameClass(name)} whitespace-nowrap`}
                        style={useShadow}
                      >
                        {name}
                      </span>
                    </span>
                  ))}
                </li>
              );
            })}
        </ul>
      </div>
    </aside>
  );
}

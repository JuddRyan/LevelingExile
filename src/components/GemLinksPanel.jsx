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
 * Right-side popup panel listing PoB socket groups (gem links)
 * for the selected skill set. One readable line per link.
 *
 * Overlay locked (!interactive): transparent like the main checklist;
 * header/title/close hidden so the first link aligns with the skill-set row.
 * Overlay interactive: light tinted popup with title + close.
 * Non-overlay: solid settings-style look.
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
  const lockedOverlay = overlay && !interactive;
  /** Title + close only while editing (or non-overlay). */
  const showChrome = !overlay || interactive;
  const useShadow = overlay ? { textShadow } : undefined;

  const shellClass = lockedOverlay
    ? 'bg-transparent border-transparent shadow-none'
    : overlay
      ? 'bg-slate-950/35 border-amber-400/55 shadow-xl'
      : 'bg-slate-950/95 border-amber-500/35 shadow-2xl';

  const headerClass = overlay
    ? 'border-amber-400/30'
    : 'border-amber-500/25';

  const closeClass = overlay
    ? 'border-amber-400/40 text-amber-100/85 bg-black/40 hover:bg-black/60'
    : 'border-amber-500/35 text-amber-100/85 bg-black/35 hover:bg-black/50';

  // Match main checklist row chrome in overlay (see App.jsx gem list buttons).
  const rowClass = overlay
    ? 'bg-black/40 border border-white/10'
    : 'bg-slate-900/80 border border-amber-500/20';

  return (
    <aside
      className={[
        'w-[200px] h-full shrink-0 flex flex-col overflow-hidden border rounded-md',
        shellClass,
        enabled ? '' : 'pointer-events-none',
      ].join(' ')}
      aria-label="Gem links"
    >
      {showChrome ? (
        <div
          className={[
            'flex items-center justify-between gap-1 px-2 py-1.5 shrink-0 border-b',
            headerClass,
          ].join(' ')}
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
              'rounded px-1.5 py-0.5 text-[10px] border transition',
              closeClass,
              enabled ? '' : 'opacity-60',
            ].join(' ')}
            style={useShadow}
          >
            ✕
          </button>
        </div>
      ) : (
        // Match main column header height so the first link lines up with
        // the skill-set select / Links button row.
        <div
          className="flex items-center px-2 py-1.5 shrink-0 invisible"
          aria-hidden
        >
          <span className="rounded p-1 inline-flex items-center justify-center">
            <span className="h-3.5 w-3.5" />
          </span>
        </div>
      )}

      <ul className="flex-1 overflow-y-auto px-2 pt-0 pb-2 space-y-1.5">
        {!hasLinks && (
          <li
            className="px-1 py-4 text-center text-[11px] text-amber-100/45 leading-snug"
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
    </aside>
  );
}

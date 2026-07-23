import { useMemo, useState } from 'react';
import gemIcons from '../data/gemIcons.json';

/** Vite-resolved local icons: key = relative path under assets/gems */
const LOCAL_ICON_MODULES = import.meta.glob('../assets/gems/**/*.{webp,png}', {
  eager: true,
  query: '?url',
  import: 'default',
});

const LOCAL_BY_REL = new Map(
  Object.entries(LOCAL_ICON_MODULES).map(([modPath, url]) => {
    const rel = modPath.replace(/^\.\.\/assets\/gems\//, '');
    return [rel.replace(/\\/g, '/'), url];
  }),
);

const ICON_BY_NAME = new Map(
  Object.entries(gemIcons).map(([name, rel]) => [name.toLowerCase(), rel]),
);

function resolveLocal(rel) {
  if (!rel) return null;
  const normalized = String(rel).replace(/\\/g, '/');
  return LOCAL_BY_REL.get(normalized) || null;
}

function lookupIconUrl(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;

  const direct = ICON_BY_NAME.get(raw.toLowerCase());
  const directUrl = resolveLocal(direct);
  if (directUrl) return directUrl;

  // Vaal X → try base gem art as last resort is wrong; try exact map only
  if (raw.endsWith(' Support')) {
    const short = raw.replace(/ Support$/i, '');
    const hit = resolveLocal(ICON_BY_NAME.get(short.toLowerCase()));
    if (hit) return hit;
  } else {
    const withSupport = `${raw} Support`;
    const hit = resolveLocal(ICON_BY_NAME.get(withSupport.toLowerCase()));
    if (hit) return hit;
  }

  // Heuristic local fallback for unmapped names
  const isSupport = / support$/i.test(raw);
  const isVaal = /^vaal /i.test(raw);
  const compact = raw.replace(/ support$/i, '').replace(/\s+/g, '');
  if (isSupport) {
    return resolveLocal(`Support/${compact}.webp`);
  }
  if (isVaal) {
    return resolveLocal(`VaalGems/${compact}.webp`);
  }
  return resolveLocal(`${compact}.webp`);
}

export function gemIconUrl(name) {
  return lookupIconUrl(name);
}

export default function GemIcon({ name, className = '', overlay = false }) {
  const src = useMemo(() => lookupIconUrl(name), [name]);
  const [failed, setFailed] = useState(false);

  // Reset failure state when gem name / url changes
  const [prevName, setPrevName] = useState(name);
  if (name !== prevName) {
    setPrevName(name);
    setFailed(false);
  }

  if (!src || failed) {
    return (
      <span
        className={[
          'inline-block shrink-0 rounded-sm bg-amber-500/20 border border-amber-500/25',
          className || 'h-6 w-6',
        ].join(' ')}
        aria-hidden
      />
    );
  }

  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className={[
        'shrink-0 object-contain rounded-sm',
        overlay ? 'drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]' : '',
        className || 'h-6 w-6',
      ].join(' ')}
    />
  );
}

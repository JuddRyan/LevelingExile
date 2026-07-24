import { inflate, inflateRaw } from 'pako';
import {
  compareEnrichedGems,
  enrichGem,
  canonicalizePoBGemName,
  skillIdToName,
} from '../data/gemLookup';
import {
  looksLikePoBPayload,
  pastebinRawUrl,
  pobbRawUrl,
  sanitizePoBResponse,
} from './pobUrls';

export {
  looksLikePoBPayload,
  pastebinRawUrl,
  pobbRawUrl,
  sanitizePoBResponse,
} from './pobUrls';

const FETCH_HEADERS = {
  // pobb.in asks integrations to identify themselves; pastebin is picky too.
  'User-Agent':
    'LevelingExile/1.0 (PoE gem overlay; https://github.com/local/LevelingExile)',
  Accept: 'text/plain,application/octet-stream,*/*;q=0.8',
};

/**
 * Resolve Pastebin / Pobb.in / raw PoB input into the encoded payload string.
 */
export async function resolvePoBPayload(input) {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Paste a PoB link or raw code first.');
  }

  const pastebin = pastebinRawUrl(trimmed);
  if (pastebin) {
    return fetchText(pastebin);
  }

  const pobb = pobbRawUrl(trimmed);
  if (pobb) {
    return fetchText(pobb);
  }

  // Raw code — only strip whitespace once we know it looks like PoB.
  if (looksLikePoBPayload(trimmed) || trimmed.replace(/\s+/g, '').length > 80) {
    return sanitizePoBResponse(trimmed, 'paste');
  }

  throw new Error(
    'Unrecognized input. Paste a pastebin.com / pobb.in link, or raw PoB code.',
  );
}

function errMessage(err) {
  if (!err) return 'unknown error';
  if (typeof err === 'string') return err;
  return err.message || String(err);
}

async function fetchText(url) {
  const errors = [];

  try {
    const { fetch } = await import('@tauri-apps/plugin-http');
    const res = await fetch(url, { method: 'GET', headers: FETCH_HEADERS });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return sanitizePoBResponse(await res.text(), url);
  } catch (err) {
    errors.push(`app fetch: ${errMessage(err)}`);
  }

  try {
    const res = await globalThis.fetch(url, {
      method: 'GET',
      headers: FETCH_HEADERS,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return sanitizePoBResponse(await res.text(), url);
  } catch (err) {
    errors.push(`browser fetch: ${errMessage(err)}`);
  }

  throw new Error(
    `Could not download PoB from ${url}. ${errors.join(' · ')}`,
  );
}

/**
 * Inflate a Path of Building Base64+Zlib payload into XML text.
 */
export function inflatePoBCode(code) {
  let b64 = code.trim().replace(/\s+/g, '');
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';

  let binary;
  try {
    binary = atob(b64);
  } catch {
    throw new Error('PoB payload is not valid Base64.');
  }

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  try {
    return inflate(bytes, { toText: true });
  } catch {
    try {
      return inflateRaw(bytes, { toText: true });
    } catch (err) {
      throw new Error(
        `Could not decompress PoB payload (${errMessage(err)}).`,
      );
    }
  }
}

function parseXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('PoB payload did not decompress into valid XML.');
  }
  return doc;
}

function gemNameFromNode(node) {
  const skillId = node.getAttribute('skillId');
  const candidates = [
    node.getAttribute('nameSpec'),
    node.getAttribute('name'),
    node.getAttribute('gemName'),
    skillIdToName(skillId),
    skillId,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const name = canonicalizePoBGemName(raw);
    if (!name) continue;
    return name;
  }

  return canonicalizePoBGemName(null, skillId);
}

/** PoB socket group: enabled if enabled="true" or active="true". */
function isSkillGroupEnabled(node) {
  return (
    node.getAttribute('enabled') === 'true' ||
    node.getAttribute('active') === 'true'
  );
}

/** PoB gem: enabled when attribute is missing or "true". */
function isGemEnabled(node) {
  const enabled = node.getAttribute('enabled');
  return enabled == null || enabled === '' || enabled === 'true';
}

/**
 * Extract linked socket groups under a Skills / SkillSet root.
 * Each link preserves PoB gem order (active + supports). Prefer enabled
 * groups/gems to match PoB visibility; fall back to all non-empty groups
 * when nothing enabled remains (so a fully-disabled set still shows links).
 */
export function extractLinksFromRoot(root) {
  const skillNodes = [...root.querySelectorAll(':scope > Skill')];

  function collect(enabledOnly) {
    const links = [];
    for (const skill of skillNodes) {
      if (enabledOnly && !isSkillGroupEnabled(skill)) continue;

      const gems = [];
      for (const gem of skill.querySelectorAll(':scope > Gem')) {
        if (enabledOnly && !isGemEnabled(gem)) continue;
        const name = gemNameFromNode(gem);
        if (!name) continue;
        gems.push(name);
      }

      if (gems.length > 0) {
        links.push({ gems });
      }
    }
    return links;
  }

  const enabledLinks = collect(true);
  if (enabledLinks.length > 0) return enabledLinks;
  return collect(false);
}

/**
 * Extract gems under a Skills / SkillSet root (including disabled gems).
 * Same gem name (case-insensitive) appears once with a count.
 */
export function extractGemsFromRoot(root) {
  const gemNodes = root.querySelectorAll('Gem');
  const byKey = new Map(); // lower → { name, count }

  gemNodes.forEach((node) => {
    const name = gemNameFromNode(node);
    if (!name) return;
    const key = name.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(key, { name, count: 1 });
    }
  });

  return [...byKey.values()];
}

function enrichAndSort(entries, className) {
  return entries
    .map(({ name, count }) => ({
      ...enrichGem(name, className),
      count: count > 1 ? count : 1,
    }))
    .sort(compareEnrichedGems);
}

/**
 * Parse all PoB skill sets (+ class / active set).
 */
export function extractSkillSetsFromXml(xml) {
  const doc = parseXml(xml);
  const skillsRoot = doc.querySelector('Skills');
  if (!skillsRoot) {
    throw new Error('No <Skills> section found in PoB XML.');
  }

  const build = doc.querySelector('Build');
  const className =
    build?.getAttribute('className') ||
    build?.getAttribute('class') ||
    null;

  const activeSkillSetId =
    skillsRoot.getAttribute('activeSkillSet') ||
    skillsRoot.getAttribute('activeSkillSetId') ||
    null;

  const skillSetNodes = [...skillsRoot.querySelectorAll(':scope > SkillSet')];

  let skillSets;
  if (skillSetNodes.length === 0) {
    const entries = extractGemsFromRoot(skillsRoot);
    skillSets = [
      {
        id: 'default',
        title: 'Default',
        gems: enrichAndSort(entries, className),
        // Build layout — not sorted by campaign act order.
        links: extractLinksFromRoot(skillsRoot),
      },
    ];
  } else {
    skillSets = skillSetNodes.map((node, index) => {
      const id = node.getAttribute('id') || String(index + 1);
      const title =
        node.getAttribute('title') ||
        node.getAttribute('name') ||
        `Skill Set ${index + 1}`;
      const entries = extractGemsFromRoot(node);
      return {
        id,
        title,
        gems: enrichAndSort(entries, className),
        // Build layout — not sorted by campaign act order.
        links: extractLinksFromRoot(node),
      };
    });
  }

  // Prefer PoB's active set; otherwise first non-empty set
  let selectedId = activeSkillSetId;
  if (!selectedId || !skillSets.some((s) => s.id === selectedId)) {
    selectedId =
      skillSets.find((s) => s.gems.length > 0)?.id || skillSets[0]?.id || null;
  }

  return {
    className,
    activeSkillSetId: selectedId,
    skillSets,
  };
}

/**
 * Fetch (if needed), inflate, and parse PoB into skill sets + enriched gems.
 */
export async function parsePoBImport(input) {
  const payload = await resolvePoBPayload(input);
  const xml = inflatePoBCode(payload);
  const parsed = extractSkillSetsFromXml(xml);

  const totalGems = parsed.skillSets.reduce((n, s) => n + s.gems.length, 0);
  if (totalGems === 0) {
    throw new Error('No skill gems found in the <Skills> section.');
  }

  return parsed;
}

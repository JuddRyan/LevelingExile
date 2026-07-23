/**
 * Pastebin / pobb.in URL resolution + PoB payload shape checks.
 * Kept free of gem/XML deps so Node can unit-test it.
 */

/**
 * Resolve a pastebin.com URL (with or without /raw, www, http/https) to a raw URL.
 * @returns {string|null}
 */
export function pastebinRawUrl(input) {
  const m = String(input)
    .trim()
    .match(
      /(?:https?:\/\/)?(?:www\.)?pastebin\.com\/(?:raw\/)?([A-Za-z0-9]+)(?:[/?#]|$)/i,
    );
  if (!m) return null;
  return `https://pastebin.com/raw/${m[1]}`;
}

/**
 * Resolve a pobb.in URL (id, id/raw, or /u/user/id[/raw]) to a raw URL.
 * @returns {string|null}
 */
export function pobbRawUrl(input) {
  const trimmed = String(input).trim();

  const userMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?pobb\.in\/u\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)(?:\/raw)?(?:[/?#]|$)/i,
  );
  if (userMatch) {
    return `https://pobb.in/u/${userMatch[1]}/${userMatch[2]}/raw`;
  }

  const idMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?pobb\.in\/([A-Za-z0-9_-]+)(?:\/raw)?(?:[/?#]|$)/i,
  );
  if (idMatch) {
    // Avoid treating the literal path segment "u" as an id when incomplete.
    if (idMatch[1].toLowerCase() === 'u') return null;
    return `https://pobb.in/${idMatch[1]}/raw`;
  }

  return null;
}

/** True if text looks like a PoB base64/zlib code (not HTML / JSON error). */
export function looksLikePoBPayload(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^<!DOCTYPE/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) return false;
  if (/<head[\s>]/i.test(trimmed) && /<body[\s>]/i.test(trimmed)) return false;
  if (/^\{[\s\S]*"error"/i.test(trimmed)) return false;
  if (/^Error\b/i.test(trimmed) && trimmed.length < 200) return false;

  const compact = trimmed.replace(/\s+/g, '');
  // Real PoB exports are long base64 (url-safe or standard).
  if (compact.length < 80) return false;
  return /^[A-Za-z0-9+/=_-]+$/.test(compact);
}

/**
 * Compact a verified PoB payload; refuse HTML/error pages.
 */
export function sanitizePoBResponse(text, sourceLabel = 'response') {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    throw new Error(`Empty ${sourceLabel}.`);
  }
  if (!looksLikePoBPayload(trimmed)) {
    throw new Error(
      `Got a non-PoB ${sourceLabel} (HTML or error page). The paste may be private, expired, or blocked.`,
    );
  }
  return trimmed.replace(/\s+/g, '');
}

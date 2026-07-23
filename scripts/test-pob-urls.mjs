/**
 * Quick URL-resolution checks for pastebin / pobb.in (no network).
 * Usage: node scripts/test-pob-urls.mjs
 */
import {
  pastebinRawUrl,
  pobbRawUrl,
  looksLikePoBPayload,
  sanitizePoBResponse,
} from '../src/lib/pobUrls.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const pastebinCases = [
  ['https://pastebin.com/AbCd1234', 'https://pastebin.com/raw/AbCd1234'],
  ['http://www.pastebin.com/AbCd1234', 'https://pastebin.com/raw/AbCd1234'],
  ['https://pastebin.com/raw/AbCd1234', 'https://pastebin.com/raw/AbCd1234'],
  ['pastebin.com/raw/AbCd1234', 'https://pastebin.com/raw/AbCd1234'],
  ['https://pastebin.com/AbCd1234?foo=1', 'https://pastebin.com/raw/AbCd1234'],
];

for (const [input, expected] of pastebinCases) {
  assert(
    pastebinRawUrl(input) === expected,
    `pastebin: ${input} → ${pastebinRawUrl(input)} (want ${expected})`,
  );
}

const pobbCases = [
  ['https://pobb.in/eQVFNoqVZrza', 'https://pobb.in/eQVFNoqVZrza/raw'],
  ['http://www.pobb.in/eQVFNoqVZrza', 'https://pobb.in/eQVFNoqVZrza/raw'],
  ['https://pobb.in/eQVFNoqVZrza/raw', 'https://pobb.in/eQVFNoqVZrza/raw'],
  ['pobb.in/eQVFNoqVZrza/raw/', 'https://pobb.in/eQVFNoqVZrza/raw'],
  [
    'https://pobb.in/u/SomeUser/eQVFNoqVZrza',
    'https://pobb.in/u/SomeUser/eQVFNoqVZrza/raw',
  ],
  [
    'https://pobb.in/u/SomeUser/eQVFNoqVZrza/raw',
    'https://pobb.in/u/SomeUser/eQVFNoqVZrza/raw',
  ],
];

for (const [input, expected] of pobbCases) {
  assert(
    pobbRawUrl(input) === expected,
    `pobb: ${input} → ${pobbRawUrl(input)} (want ${expected})`,
  );
}

assert(pastebinRawUrl('not a link') === null, 'non-pastebin → null');
assert(pobbRawUrl('https://example.com/x') === null, 'non-pobb → null');

const fakePoB = `eJ${'A'.repeat(100)}==`;
assert(looksLikePoBPayload(fakePoB), 'base64-ish looks like PoB');
assert(!looksLikePoBPayload('<!DOCTYPE html><html><body>nope</body></html>'), 'html rejected');
assert(!looksLikePoBPayload('<html><head></head><body>x</body></html>'), 'html body rejected');

try {
  sanitizePoBResponse('<!DOCTYPE html><html><body>blocked</body></html>', 'test');
  throw new Error('sanitize should have thrown on HTML');
} catch (err) {
  assert(/non-PoB/i.test(err.message), `sanitize HTML message: ${err.message}`);
}

assert(
  sanitizePoBResponse(`  ${fakePoB}  \n`) === fakePoB.replace(/\s+/g, ''),
  'sanitize compacts valid payload',
);

console.log('All PoB URL / payload checks passed.');

/**
 * Rebuild gem-catalog.json from RePoE base_items + gems (true required_level)
 * and fill missing gemIcons (poedb CDN .webp) in one pass.
 *
 * Usage: npm run update:gems
 *    or: node scripts/update-gems.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const outRoot = path.join(root, 'src', 'assets', 'gems');
const iconsPath = path.join(dataDir, 'gemIcons.json');
const catalogPath = path.join(dataDir, 'gem-catalog.json');

const REPOE_BASE_ITEMS_URL =
  'https://repoe-fork.github.io/base_items.min.json';
const REPOE_GEMS_URL = 'https://repoe-fork.github.io/gems.min.json';
const CDN_PREFIX = 'https://cdn.poedb.tw/image/';
const ART_PREFIX = 'Art/2DItems/Gems/';
const GEM_CLASSES = new Set(['Active Skill Gem', 'Support Skill Gem']);

const QUEST_LEVEL = {
  'The Twilight Strand': 1,
  'Enemy at the Gate': 1,
  'Mercy Mission': 4,
  'Breaking Some Eggs': 4,
  'The Caged Brute': 8,
  "The Siren's Cadence": 12,
  'Intruders in Black': 16,
  'Sharp and Cruel': 24,
  'Lost in Love': 28,
  'Sever the Right Hand': 31,
  'A Fixture of Fate': 31,
  'Breaking the Seal': 38,
  'The Eternal Nightmare': 38,
  'Fallen from Grace': 45,
};

function normalizeKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isPlayableGemName(name) {
  if (!name) return false;
  if (/^\[UNUSED\]/i.test(name)) return false;
  if (/\bWIP\b/i.test(name)) return false;
  if (/^\[DNT\]/i.test(name)) return false;
  return true;
}

async function fetchJson(url) {
  console.log(`Fetching ${url} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function loadJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(dataDir, rel), 'utf8'));
}

/** Build name → { quest_rewards, vendor_rewards } from quest-gem-rewards.json */
function rewardsFromQuestFile(questData) {
  const byName = new Map();

  function ensure(name) {
    const key = normalizeKey(name);
    if (!byName.has(key)) {
      byName.set(key, {
        name,
        quest_rewards: [],
        vendor_rewards: [],
      });
    }
    return byName.get(key);
  }

  function pushUnique(list, entry, keyFn) {
    const k = keyFn(entry);
    if (list.some((e) => keyFn(e) === k)) return;
    list.push(entry);
  }

  for (const quest of questData.quest_gem_rewards || []) {
    const act = String(quest.act);
    const questName = quest.quest;
    const npc = quest.npc;
    for (const [className, gems] of Object.entries(quest.rewards || {})) {
      for (const gemName of gems || []) {
        const rec = ensure(gemName);
        pushUnique(
          rec.quest_rewards,
          { quest: questName, act, classes: [className] },
          (e) => `${e.quest}|${e.act}|${(e.classes || []).join(',')}`,
        );
        if (npc) {
          pushUnique(
            rec.vendor_rewards,
            {
              npc,
              quest: questName,
              act,
              classes: [className],
            },
            (e) =>
              `${e.npc}|${e.quest}|${e.act}|${(e.classes || []).join(',')}`,
          );
        }
      }
    }
  }

  for (const rec of byName.values()) {
    rec.quest_rewards = mergeClassLists(rec.quest_rewards, (e) =>
      `${e.quest}|${e.act}`,
    );
    rec.vendor_rewards = mergeClassLists(rec.vendor_rewards, (e) =>
      `${e.npc}|${e.quest}|${e.act}`,
    );
  }

  return byName;
}

function mergeClassLists(entries, groupKey) {
  const groups = new Map();
  for (const e of entries) {
    const k = groupKey(e);
    if (!groups.has(k)) {
      groups.set(k, { ...e, classes: [...(e.classes || [])] });
    } else {
      const g = groups.get(k);
      for (const c of e.classes || []) {
        if (!g.classes.includes(c)) g.classes.push(c);
      }
    }
  }
  return [...groups.values()];
}

function extractGemsFromBaseItems(baseItems) {
  const byName = new Map();

  for (const [id, item] of Object.entries(baseItems)) {
    if (!GEM_CLASSES.has(item?.item_class)) continue;
    if (item.release_state && item.release_state !== 'released') continue;

    const name = String(item.name || '').trim();
    if (!isPlayableGemName(name)) continue;

    const key = normalizeKey(name);
    const existing = byName.get(key);
    // Do NOT use base_items drop_level as required_level — that skews many gems.
    const entry = {
      name,
      required_level: null,
      primary_attr: null,
      item_class: item.item_class,
      repoe_id: id,
      quest_rewards: [],
      vendor_rewards: [],
    };

    if (!existing) {
      byName.set(key, entry);
    }
  }

  return byName;
}

/**
 * True gem required levels from RePoE gems.json (per_level["1"].required_level).
 * Indexed by base_item id and display name — never drop_level.
 */
function requiredLevelsFromGemsJson(gemsJson) {
  const byBaseId = new Map();
  const byName = new Map();

  for (const gem of Object.values(gemsJson || {})) {
    const pl1 = gem?.per_level?.['1'] ?? gem?.per_level?.[1];
    const req = Number(pl1?.required_level ?? gem?.static?.required_level);
    if (!Number.isFinite(req)) continue;

    const baseId = gem?.base_item?.id;
    if (baseId) {
      const prev = byBaseId.get(baseId);
      if (prev == null || req < prev) byBaseId.set(baseId, req);
    }

    const name = String(
      gem?.display_name || gem?.base_item?.display_name || '',
    ).trim();
    if (!name || !isPlayableGemName(name)) continue;
    const key = normalizeKey(name);
    const prev = byName.get(key);
    if (prev == null || req < prev) byName.set(key, req);
  }

  return { byBaseId, byName };
}

function applyRequiredLevels(catalogByName, gemsJson) {
  const { byBaseId, byName } = requiredLevelsFromGemsJson(gemsJson);
  let filled = 0;
  for (const gem of catalogByName.values()) {
    const fromId = gem.repoe_id ? byBaseId.get(gem.repoe_id) : null;
    const fromName = byName.get(normalizeKey(gem.name));
    const req = fromId ?? fromName;
    if (req != null) {
      gem.required_level = String(req);
      filled += 1;
    }
  }
  return { filled, byBaseId: byBaseId.size, byName: byName.size };
}

function mergeRewards(catalogByName, questByName) {
  for (const gem of catalogByName.values()) {
    const fromQuest = questByName.get(normalizeKey(gem.name));

    if (fromQuest) {
      if (!gem.quest_rewards.length && fromQuest.quest_rewards.length) {
        gem.quest_rewards = structuredClone(fromQuest.quest_rewards);
      } else if (fromQuest.quest_rewards.length) {
        gem.quest_rewards = mergeClassLists(
          [...gem.quest_rewards, ...fromQuest.quest_rewards],
          (e) => `${e.quest}|${e.act}`,
        );
      }

      if (!gem.vendor_rewards.length && fromQuest.vendor_rewards.length) {
        gem.vendor_rewards = structuredClone(fromQuest.vendor_rewards);
      } else if (fromQuest.vendor_rewards.length) {
        gem.vendor_rewards = mergeClassLists(
          [...gem.vendor_rewards, ...fromQuest.vendor_rewards],
          (e) => `${e.npc}|${e.quest}|${e.act}`,
        );
      }

      if (!gem.required_level && fromQuest.quest_rewards.length) {
        const levels = fromQuest.quest_rewards
          .map((q) => QUEST_LEVEL[q.quest])
          .filter((n) => Number.isFinite(n));
        if (levels.length) {
          gem.required_level = String(Math.min(...levels));
        }
      }
    }

    const hasLilly = (gem.vendor_rewards || []).some(
      (v) =>
        v.npc === 'Lilly Roth' &&
        (v.quest === 'Fallen from Grace' || Number(v.act) === 6),
    );
    if (!hasLilly) {
      gem.vendor_rewards = [
        ...(gem.vendor_rewards || []),
        {
          npc: 'Lilly Roth',
          quest: 'Fallen from Grace',
          act: '6',
          classes: [],
        },
      ];
    }

    if (!gem.required_level) gem.required_level = '1';
  }
}

function rebuildCatalog(baseItems, gemsJson) {
  const questData = loadJson('quest-gem-rewards.json');

  const catalogByName = extractGemsFromBaseItems(baseItems);
  const levelStats = applyRequiredLevels(catalogByName, gemsJson);
  const questByName = rewardsFromQuestFile(questData);

  mergeRewards(catalogByName, questByName);

  const gems = [...catalogByName.values()]
    .map(({ repoe_id, item_class, ...rest }) => ({
      ...rest,
      item_class,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const out = {
    _comment:
      'Rebuilt from RePoE base_items + gems.json required_level (not drop_level) + quest-gem-rewards. Run: npm run update:gems',
    _source: {
      base_items: REPOE_BASE_ITEMS_URL,
      gems: REPOE_GEMS_URL,
    },
    _generated_at: new Date().toISOString(),
    gems,
  };

  fs.writeFileSync(catalogPath, `${JSON.stringify(out, null, 1)}\n`);

  const supports = gems.filter((g) => / Support$/i.test(g.name));
  const skills = gems.filter((g) => !/ Support$/i.test(g.name));
  const modernMissing = [
    'Arrogance Support',
    'Hextouch Support',
    'Chance to Poison Support',
    'Ballista Totem Support',
    'Divine Blessing Support',
    'Eternal Blessing Support',
    'Momentum Support',
    'Prismatic Burst Support',
    'Archmage Support',
    'Trinity Support',
    'Lifetap Support',
    'Awakened Multistrike Support',
    'Absolution',
    'Boneshatter',
    'Hexblast',
  ];
  const checks = Object.fromEntries(
    modernMissing.map((n) => [n, gems.some((g) => g.name === n)]),
  );

  const sampleLevels = Object.fromEntries(
    [
      'Prismatic Burst Support',
      'Momentum Support',
      'Shield Charge',
      'Controlled Destruction Support',
      'Added Chaos Damage Support',
      'Fireball',
    ].map((n) => {
      const g = gems.find((x) => x.name === n);
      return [n, g?.required_level ?? null];
    }),
  );

  return {
    gems,
    summary: {
      total: gems.length,
      skills: skills.length,
      supports: supports.length,
      outPath: catalogPath,
      requiredLevels: levelStats,
      sampleLevels,
      modernMissingCheck: checks,
      allModernPresent: Object.values(checks).every(Boolean),
    },
  };
}

/** Art/2DItems/Gems/Support/Foo.dds → Support/Foo.webp */
function ddsToRelWebp(ddsFile) {
  if (!ddsFile || typeof ddsFile !== 'string') return null;
  let p = ddsFile.replace(/\\/g, '/');
  if (!p.endsWith('.dds')) return null;
  p = p.slice(0, -4) + '.webp';
  if (p.startsWith(ART_PREFIX)) p = p.slice(ART_PREFIX.length);
  else if (p.startsWith('Art/2DItems/Gems/'))
    p = p.slice('Art/2DItems/Gems/'.length);
  return p;
}

function cdnUrl(relWebp) {
  return `${CDN_PREFIX}${ART_PREFIX}${relWebp}`;
}

function buildRepoeIconMap(baseItems) {
  /** @type {Map<string, { name: string, rel: string }>} */
  const byName = new Map();

  for (const item of Object.values(baseItems)) {
    if (!GEM_CLASSES.has(item?.item_class)) continue;
    if (item.release_state && item.release_state !== 'released') continue;
    const name = String(item.name || '').trim();
    if (!isPlayableGemName(name)) continue;
    const dds = item.visual_identity?.dds_file;
    const rel = ddsToRelWebp(dds);
    if (!rel) continue;
    byName.set(normalizeKey(name), { name, rel });
  }
  return byName;
}

async function downloadOne(rel) {
  const dest = path.join(outRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size >= 32) {
    return { ok: true, skipped: true };
  }

  const url = cdnUrl(rel);
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'image/webp,image/*,*/*;q=0.8',
      Referer: 'https://poedb.tw/',
    },
  });
  if (!res.ok) return { ok: false, status: res.status, url };
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) return { ok: false, status: 'tiny', url };
  fs.writeFileSync(dest, buf);
  return { ok: true, skipped: false };
}

async function runPool(items, limit, worker) {
  let i = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

async function fillMissingIcons(baseItems, catalogGems) {
  const icons = JSON.parse(fs.readFileSync(iconsPath, 'utf8'));

  const missingNames = (catalogGems || [])
    .map((g) => g.name)
    .filter((n) => n && !icons[n]);

  console.log(
    `Catalog gems missing from gemIcons.json: ${missingNames.length}`,
  );

  const repoeMap = buildRepoeIconMap(baseItems);

  const filled = [];
  const noRepoe = [];
  const newRels = new Set();

  for (const name of missingNames) {
    const hit = repoeMap.get(normalizeKey(name));
    if (!hit) {
      noRepoe.push(name);
      continue;
    }
    icons[name] = hit.rel;
    filled.push({ name, rel: hit.rel, cdn: cdnUrl(hit.rel) });
    newRels.add(hit.rel);
  }

  const merged = {};
  for (const [k, v] of Object.entries(icons)) merged[k] = v;
  fs.writeFileSync(iconsPath, `${JSON.stringify(merged)}\n`);

  console.log(`Added ${filled.length} icon mappings to gemIcons.json`);
  if (noRepoe.length) {
    console.log(`No RePoE art for ${noRepoe.length} gems:`);
    for (const n of noRepoe.slice(0, 20)) console.log(`  - ${n}`);
    if (noRepoe.length > 20) console.log(`  …and ${noRepoe.length - 20} more`);
  }

  const toDownload = [...newRels];
  console.log(`Downloading ${toDownload.length} unique icon files…`);
  fs.mkdirSync(outRoot, { recursive: true });

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const failures = [];

  await runPool(toDownload, 10, async (rel) => {
    const result = await downloadOne(rel);
    if (result.ok) {
      if (result.skipped) skipped += 1;
      else ok += 1;
    } else {
      failed += 1;
      failures.push(`${result.status} ${result.url}`);
    }
    const total = ok + skipped + failed;
    if (total % 10 === 0 || total === toDownload.length) {
      process.stdout.write(
        `\rdownloaded ${ok} skipped ${skipped} failed ${failed}/${toDownload.length}`,
      );
    }
  });
  if (toDownload.length) process.stdout.write('\n');

  return {
    missingBefore: missingNames.length,
    filled: filled.length,
    noRepoe: noRepoe.length,
    noRepoeNames: noRepoe,
    downloaded: ok,
    skippedExisting: skipped,
    downloadFailed: failed,
    failures: failures.slice(0, 40),
    samples: filled.slice(0, 15),
  };
}

async function main() {
  const [baseItems, gemsJson] = await Promise.all([
    fetchJson(REPOE_BASE_ITEMS_URL),
    fetchJson(REPOE_GEMS_URL),
  ]);

  console.log('Rebuilding gem-catalog.json …');
  const { gems, summary: catalogSummary } = rebuildCatalog(baseItems, gemsJson);
  console.log(
    `Catalog: ${catalogSummary.total} gems (${catalogSummary.skills} skills, ${catalogSummary.supports} supports)`,
  );
  console.log(
    `Required levels from gems.json: ${catalogSummary.requiredLevels.filled}/${catalogSummary.total}`,
  );
  console.log('Sample levels:', catalogSummary.sampleLevels);

  console.log('Filling missing gem icons …');
  const iconSummary = await fillMissingIcons(baseItems, gems);

  const summary = { catalog: catalogSummary, icons: iconSummary };
  console.log(JSON.stringify(summary, null, 2));

  if (iconSummary.downloadFailed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

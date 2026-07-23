import gemsData from './gem-catalog.json' with { type: 'json' };
import questRewardsData from './quest-gem-rewards.json' with { type: 'json' };
import questOrderData from './quest-order.json' with { type: 'json' };

/** Campaign quest order + unlock level from quest-order.json (array order = progress). */
const QUEST_ORDER = new Map();
const QUEST_LEVEL = new Map();
const QUEST_ACT = new Map();
for (const [i, entry] of (questOrderData.quests || []).entries()) {
  if (!entry?.quest) continue;
  QUEST_ORDER.set(entry.quest, i);
  if (Number.isFinite(Number(entry.level))) {
    QUEST_LEVEL.set(entry.quest, Number(entry.level));
  }
  if (Number.isFinite(Number(entry.act))) {
    QUEST_ACT.set(entry.quest, Number(entry.act));
  }
}

const UNKNOWN_QUEST_ORDER = 9999;

/** Quest → NPC from campaign reward tables. */
const QUEST_NPC = Object.fromEntries(
  (questRewardsData.quest_gem_rewards || []).map((q) => [q.quest, q.npc]),
);
for (const v of questRewardsData.vendor_unlocks || []) {
  QUEST_NPC[v.quest] = v.npc;
}

const GEM_BY_NAME = new Map();
for (const gem of gemsData.gems || []) {
  if (!gem?.name) continue;
  GEM_BY_NAME.set(normalizeKey(gem.name), gem);
  // Also index without trailing " Support"
  if (gem.name.endsWith(' Support')) {
    GEM_BY_NAME.set(normalizeKey(gem.name.replace(/ Support$/, '')), gem);
  }
}

function normalizeKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function questOrderIndex(quest) {
  if (quest && QUEST_ORDER.has(quest)) return QUEST_ORDER.get(quest);
  return UNKNOWN_QUEST_ORDER;
}

function finiteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Unlock / display level for a campaign source.
 * Prefer true RePoE required_level, then quest-order.json, then act fallback.
 */
function sourceLevel(gem, quest, act) {
  const req = finiteNumber(gem?.required_level);
  if (req != null) return req;
  if (quest && QUEST_LEVEL.has(quest)) return QUEST_LEVEL.get(quest);
  return act * 8;
}

/**
 * Convert PoB skillId / CamelCase ids into display-style names.
 * e.g. SupportAddedFireDamage → Added Fire Damage Support
 */
export function skillIdToName(skillId) {
  if (!skillId) return null;
  if (/\s/.test(skillId)) return skillId.trim();

  const isSupport = skillId.startsWith('Support');
  let body = isSupport ? skillId.slice('Support'.length) : skillId;
  body = body
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim();

  if (!body) return skillId;
  return isSupport ? `${body} Support` : body;
}

function lookupGemRecord(name) {
  const key = normalizeKey(name);
  if (!key) return null;

  if (GEM_BY_NAME.has(key)) return GEM_BY_NAME.get(key);

  // Vaal Fireball → Fireball (for campaign location hint)
  if (key.startsWith('vaal ')) {
    const base = key.slice(5);
    if (GEM_BY_NAME.has(base)) return GEM_BY_NAME.get(base);
  }

  // Try with/without Support suffix
  if (key.endsWith(' support')) {
    const without = key.replace(/ support$/, '');
    if (GEM_BY_NAME.has(without)) return GEM_BY_NAME.get(without);
  } else {
    const withSupport = `${key} support`;
    if (GEM_BY_NAME.has(withSupport)) return GEM_BY_NAME.get(withSupport);
  }

  return null;
}

function isValidAct(act) {
  return Number.isFinite(act) && act >= 1 && act <= 10;
}

function pickEarliestSource(gem, className) {
  const candidates = [];

  for (const qr of gem.quest_rewards || []) {
    const classes = qr.classes || [];
    const matchesClass =
      !className || classes.length === 0 || classes.includes(className);
    if (!matchesClass) continue;

    const act = Number(qr.act);
    if (!isValidAct(act) || !qr.quest) continue;

    candidates.push({
      act,
      quest: qr.quest,
      questOrder: questOrderIndex(qr.quest),
      vendor: QUEST_NPC[qr.quest] || 'Quest reward',
      source: 'quest',
      level: sourceLevel(gem, qr.quest, act),
    });
  }

  for (const vr of gem.vendor_rewards || []) {
    const classes = vr.classes || [];
    const matchesClass =
      !className || classes.length === 0 || classes.includes(className);
    if (!matchesClass) continue;

    const act = Number(vr.act);
    if (!isValidAct(act) || !vr.quest) continue;

    candidates.push({
      act,
      quest: vr.quest,
      questOrder: questOrderIndex(vr.quest),
      vendor: vr.npc || QUEST_NPC[vr.quest] || 'Vendor',
      source: 'vendor',
      level: sourceLevel(gem, vr.quest, act),
    });
  }

  // If class filter wiped everything, retry without class restriction
  if (candidates.length === 0 && className) {
    return pickEarliestSource(gem, null);
  }

  if (candidates.length === 0) {
    const quest = 'Fallen from Grace';
    const act = QUEST_ACT.get(quest) ?? 6;
    return {
      act,
      quest,
      questOrder: questOrderIndex(quest),
      vendor: 'Lilly Roth',
      source: 'vendor',
      level: sourceLevel(gem, quest, act),
    };
  }

  // Prefer earlier act / campaign quest order; quest reward over vendor
  candidates.sort((a, b) => {
    if (a.act !== b.act) return a.act - b.act;
    if (a.questOrder !== b.questOrder) return a.questOrder - b.questOrder;
    if (a.source !== b.source) return a.source === 'quest' ? -1 : 1;
    return a.level - b.level;
  });

  return candidates[0];
}

/** Sort: act → quest (questOrder) → level → name. */
export function compareEnrichedGems(a, b) {
  return (
    a.act - b.act ||
    (a.questOrder ?? UNKNOWN_QUEST_ORDER) - (b.questOrder ?? UNKNOWN_QUEST_ORDER) ||
    a.level - b.level ||
    a.name.localeCompare(b.name)
  );
}

/**
 * Enrich a gem display name with the earliest campaign act/quest/vendor.
 * Lookup uses gem-catalog.json.
 */
export function enrichGem(name, className = null) {
  const displayName = String(name || '').trim();
  const record = lookupGemRecord(displayName);

  if (!record) {
    const quest = 'Fallen from Grace';
    const act = QUEST_ACT.get(quest) ?? 6;
    return {
      name: displayName,
      act,
      quest,
      questOrder: questOrderIndex(quest),
      vendor: 'Lilly Roth',
      level: QUEST_LEVEL.get(quest) ?? 45,
      unknown: true,
    };
  }

  const source = pickEarliestSource(record, className);
  return {
    name: displayName,
    act: source.act,
    quest: source.quest,
    questOrder: source.questOrder,
    vendor: source.vendor,
    level: source.level,
    unknown: false,
  };
}

import gemsData from './gem-catalog.json' with { type: 'json' };
import questRewardsData from './quest-gem-rewards.json' with { type: 'json' };
import questOrderData from './quest-order.json' with { type: 'json' };

/** Campaign quest order + unlock level from quest-order.json (array order = progress). */
const QUEST_ORDER = new Map();
const QUEST_LEVEL = new Map();
for (const [i, entry] of (questOrderData.quests || []).entries()) {
  if (!entry?.quest) continue;
  QUEST_ORDER.set(entry.quest, i);
  if (Number.isFinite(Number(entry.level))) {
    QUEST_LEVEL.set(entry.quest, Number(entry.level));
  }
}

const UNKNOWN_QUEST_ORDER = Number.POSITIVE_INFINITY;
const FALLEN_FROM_GRACE = 'Fallen from Grace';
const FIXTURE_OF_FATE = 'A Fixture of Fate';

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
 * Use the later of gem required_level and quest unlock level so Act 6 Lilly
 * buys don't sort as early L1 gems, while Act 1 rewards stay at L1–4.
 */
function sourceLevel(gem, quest, act) {
  const req = finiteNumber(gem?.required_level);
  const questLvl =
    quest && QUEST_LEVEL.has(quest) ? QUEST_LEVEL.get(quest) : null;
  if (req != null && questLvl != null) return Math.max(req, questLvl);
  if (req != null) return req;
  if (questLvl != null) return questLvl;
  const a = Number(act);
  return Number.isFinite(a) ? a * 8 : 1;
}

function matchesClass(classes, className) {
  if (!className) return true;
  const list = classes || [];
  return list.length === 0 || list.includes(className);
}

/** Campaign quest usable in class-matching pass (excludes universal Lilly unlock). */
function isClassMatchingCampaignQuest(quest) {
  return Boolean(quest) && QUEST_ORDER.has(quest) && quest !== FALLEN_FROM_GRACE;
}

function vendorItemSource(gem) {
  const req = finiteNumber(gem?.required_level);
  return {
    act: null,
    quest: null,
    questOrder: UNKNOWN_QUEST_ORDER,
    vendor: 'vendor item',
    source: 'vendor',
    level: req != null ? req : 1,
    vendorItem: true,
  };
}

/** Map gem required_level onto early-campaign act bands. */
function actFromRequiredLevel(gem) {
  const req = finiteNumber(gem?.required_level);
  if (req == null) return null;
  if (req <= 12) return 1;
  if (req <= 18) return 2;
  if (req <= 31) return 3;
  if (req <= 38) return 4;
  return null;
}

/**
 * Lilly-only catalog gems that are usable in Acts 1–4: treat as vendor items
 * in the matching act, using required_level (not Fallen from Grace L45).
 */
function levelBandVendorSource(gem, act) {
  const req = finiteNumber(gem?.required_level);
  return {
    act,
    quest: null,
    questOrder: UNKNOWN_QUEST_ORDER,
    vendor: 'vendor item',
    source: 'vendor',
    level: req != null ? req : 1,
    vendorItem: true,
  };
}

function hasNoQuestRewards(gem) {
  return !(gem.quest_rewards || []).length;
}

function toSource(gem, entry, sourceType) {
  const act = Number(entry.act);
  const quest = entry.quest;
  return {
    act,
    quest,
    questOrder: questOrderIndex(quest),
    vendor:
      entry.npc ||
      QUEST_NPC[quest] ||
      (sourceType === 'quest' ? 'Quest reward' : 'Vendor'),
    source: sourceType,
    level: sourceLevel(gem, quest, act),
    vendorItem: false,
  };
}

/**
 * Universal vendors when the PoB class cannot take the class-gated campaign reward.
 * Prefer Siosa (Act 3) over Lilly Roth (Act 6). Class lists are ignored here.
 * Early Lilly-only gems (req ≤ 38, no quests) are remapped via levelBandVendorSource
 * before this is used.
 */
function pickUniversalVendor(gem) {
  const vendors = gem.vendor_rewards || [];

  const siosa = vendors.find(
    (v) => v.npc === 'Siosa' || v.quest === FIXTURE_OF_FATE,
  );
  if (siosa) {
    const act = Number(siosa.act);
    const quest = siosa.quest || FIXTURE_OF_FATE;
    if (isValidAct(act) || quest === FIXTURE_OF_FATE) {
      return toSource(
        gem,
        {
          ...siosa,
          act: isValidAct(act) ? act : 3,
          quest,
          npc: siosa.npc || 'Siosa',
        },
        'vendor',
      );
    }
  }

  const lilly = vendors.find(
    (v) => v.npc === 'Lilly Roth' || v.quest === FALLEN_FROM_GRACE,
  );
  if (lilly) {
    // Prefer level-band Act 1–4 over fake early Lilly when there are no quests.
    const bandAct = actFromRequiredLevel(gem);
    if (hasNoQuestRewards(gem) && bandAct != null) {
      return levelBandVendorSource(gem, bandAct);
    }

    const act = Number(lilly.act);
    const quest = lilly.quest || FALLEN_FROM_GRACE;
    if (isValidAct(act) || quest === FALLEN_FROM_GRACE) {
      return toSource(
        gem,
        {
          ...lilly,
          act: isValidAct(act) ? act : 6,
          quest,
          npc: lilly.npc || 'Lilly Roth',
        },
        'vendor',
      );
    }
  }

  return null;
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

/** Catalog primary_attr for a gem display name: 'str' | 'dex' | 'int' | null. */
export function getGemPrimaryAttr(name) {
  const record = lookupGemRecord(name);
  const attr = record?.primary_attr;
  if (attr === 'str' || attr === 'dex' || attr === 'int') return attr;
  return null;
}

function isValidAct(act) {
  return Number.isFinite(act) && act >= 1 && act <= 10;
}

function collectClassMatchingSources(gem, className) {
  const candidates = [];

  for (const qr of gem.quest_rewards || []) {
    if (!matchesClass(qr.classes, className)) continue;

    const act = Number(qr.act);
    if (!isValidAct(act) || !isClassMatchingCampaignQuest(qr.quest)) continue;

    candidates.push(toSource(gem, qr, 'quest'));
  }

  for (const vr of gem.vendor_rewards || []) {
    if (!matchesClass(vr.classes, className)) continue;

    const act = Number(vr.act);
    if (!isValidAct(act) || !isClassMatchingCampaignQuest(vr.quest)) continue;

    candidates.push(toSource(gem, vr, 'vendor'));
  }

  return candidates;
}

function earliestSource(candidates) {
  candidates.sort((a, b) => {
    if (a.act !== b.act) return a.act - b.act;
    if (a.questOrder !== b.questOrder) return a.questOrder - b.questOrder;
    if (a.source !== b.source) return a.source === 'quest' ? -1 : 1;
    return a.level - b.level;
  });
  return candidates[0];
}

function pickEarliestSource(gem, className) {
  const candidates = collectClassMatchingSources(gem, className);
  if (candidates.length > 0) {
    return earliestSource(candidates);
  }

  // No class-matching campaign source. Prefer any-class campaign pickup
  // (mule planning: Prismatic Burst → Twilight Strand, Momentum → Act 1)
  // before level-band / universal Siosa / Lilly buys.
  if (className) {
    const anyClass = collectClassMatchingSources(gem, null);
    if (anyClass.length > 0) {
      return earliestSource(anyClass);
    }
  }

  // Lilly-only rows with empty quest_rewards: use required_level act bands
  // so Power Siphon (L12) is Act 1, not Fallen from Grace Act 6.
  const bandAct = actFromRequiredLevel(gem);
  if (hasNoQuestRewards(gem) && bandAct != null) {
    return levelBandVendorSource(gem, bandAct);
  }

  const universal = pickUniversalVendor(gem);
  if (universal) return universal;

  return vendorItemSource(gem);
}

/**
 * Sort by level; within the same level, real sources before vendor items;
 * then act → questOrder → name.
 */
export function compareEnrichedGems(a, b) {
  const aLevel = Number(a.level) || 0;
  const bLevel = Number(b.level) || 0;
  if (aLevel !== bLevel) return aLevel - bLevel;

  const aVendor = a.vendorItem ? 1 : 0;
  const bVendor = b.vendorItem ? 1 : 0;
  if (aVendor !== bVendor) return aVendor - bVendor;

  if (!a.vendorItem && !b.vendorItem) {
    const aAct = Number.isFinite(a.act) ? a.act : 99;
    const bAct = Number.isFinite(b.act) ? b.act : 99;
    if (aAct !== bAct) return aAct - bAct;
    const aQo = Number.isFinite(a.questOrder) ? a.questOrder : UNKNOWN_QUEST_ORDER;
    const bQo = Number.isFinite(b.questOrder) ? b.questOrder : UNKNOWN_QUEST_ORDER;
    if (aQo !== bQo) return aQo - bQo;
  }

  return String(a.name || '').localeCompare(String(b.name || ''));
}

/**
 * Enrich a gem display name with the earliest campaign act/quest/vendor.
 * Lookup uses gem-catalog.json.
 */
export function enrichGem(name, className = null) {
  const displayName = String(name || '').trim();
  const record = lookupGemRecord(displayName);

  if (!record) {
    return {
      name: displayName,
      ...vendorItemSource(null),
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
    vendorItem: Boolean(source.vendorItem),
    unknown: false,
  };
}

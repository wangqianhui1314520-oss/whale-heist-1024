/** Explicit deterministic challenge contracts; no hidden rolls or campaign score changes. */
const clone = value => JSON.parse(JSON.stringify(value));
const deepFreeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; };
export const CONTRACTS = deepFreeze([
  { id: 'standard', name: '常规行动', label: '常规行动', description: '沿用章节原有布局与预算。', impacts: ['不改变章节规则'], rules: { qualifierLimit: null, patrolMultiplier: 1, shortcutsEnabled: true } },
  { id: 'low-budget', name: '低预算', label: '低预算', description: '每章初始限定词最多一枚；默认指令与静态保底路线保留。', impacts: ['初始限定词上限 1', '补给数量与默认指令不变'], rules: { qualifierLimit: 1, patrolMultiplier: 1, shortcutsEnabled: true } },
  { id: 'dense-patrol', name: '巡逻加密', label: '巡逻加密', description: '现有守卫巡逻速度为常规的 1.2 倍；同一种子固定起始方向与巡逻相位。', impacts: ['巡逻速度 ×1.2', '公开固定起始方向与相位', '不额外生成守卫'], rules: { qualifierLimit: null, patrolMultiplier: 1.2, shortcutsEnabled: true } },
  { id: 'closed-shortcuts', name: '关闭捷径', label: '关闭捷径', description: '关闭明确标注的可选捷径；静态梯路、主线路径与必需物品保持可达。', impacts: ['可选捷径关闭', '静态保底路线保留'], rules: { qualifierLimit: null, patrolMultiplier: 1, shortcutsEnabled: false } },
]);
const ALIASES = { regular: 'standard', 'limited-budget': 'low-budget', 'encrypted-patrol': 'dense-patrol', 'patrol-dense': 'dense-patrol', 'no-shortcuts': 'closed-shortcuts', 常规: 'standard', 低预算: 'low-budget', 巡逻加密: 'dense-patrol', 关闭捷径: 'closed-shortcuts' };
export function getContract(id = 'standard') { const entry = CONTRACTS.find(item => item.id === (ALIASES[id] ?? id)); return entry ? clone(entry) : null; }
function hash(value) { let result = 2166136261; for (const char of String(value)) { result ^= char.codePointAt(0); result = Math.imul(result, 16777619) >>> 0; } return result >>> 0; }
export function createContract(id = 'standard', { seed = 'whale-v3', chapter = 1 } = {}) {
  const base = getContract(id); if (!base) return null;
  if (!['string', 'number'].includes(typeof seed) || !String(seed).length || String(seed).length > 128 || (typeof seed === 'number' && !Number.isFinite(seed))) throw new TypeError('Invalid deterministic contract seed');
  const normalizedSeed = String(seed), chapterKey = String(chapter?.id ?? chapter);
  return { ...base, seed: normalizedSeed, chapter: chapterKey, variantId: `${base.id}:${chapterKey}:${normalizedSeed}`,
    layoutSeed: hash(`${base.id}|${chapterKey}|${normalizedSeed}`), officialCampaignScore: false };
}
export function describeContract(contract) {
  const item = typeof contract === 'string' ? getContract(contract) : contract;
  return item ? { id: item.id, title: item.name, description: item.description, impacts: [...item.impacts], seed: item.seed ?? null, variantId: item.variantId ?? null, officialCampaignScore: false } : null;
}

/** Returns a detached map/config. Optional shortcuts need shortcut:true or optionalShortcut:true. */
export function applyContract(base, selected = 'standard') {
  if (!base || typeof base !== 'object') throw new TypeError('Contract requires a chapter/map config');
  const contract = typeof selected === 'string' ? createContract(selected, { chapter: base.id ?? base.number ?? 1 }) : selected;
  if (!contract || !getContract(contract.id) || !Number.isInteger(contract.layoutSeed)) throw new TypeError('Unknown or unseeded contract');
  const result = clone(base), canonical = getContract(contract.id), rules = canonical.rules;
  if (Number.isFinite(result.qualifiers) && rules.qualifierLimit !== null) result.qualifiers = Math.min(result.qualifiers, rules.qualifierLimit);
  result.guards = (result.guards ?? []).map(guard => {
    if (contract.id !== 'dense-patrol') return guard;
    const value = hash(`${contract.layoutSeed}|${guard.id}`), phase = (value % 1001) / 1000;
    return { ...guard, speed: guard.speed * rules.patrolMultiplier, direction: value % 2 ? 1 : -1, phase,
      ...(Number.isFinite(guard.minX) && Number.isFinite(guard.maxX) ? { x: guard.minX + (guard.maxX - guard.minX) * phase } : {}) };
  });
  if (!rules.shortcutsEnabled) {
    for (const key of ['gates', 'bridges', 'portals', 'shortcuts', 'exits']) if (Array.isArray(result[key])) result[key] = result[key].map(entry =>
      entry.shortcut === true || entry.optionalShortcut === true ? { ...entry, disabled: true, open: false, contractClosed: true } : entry);
  }
  result.contract = { ...createContract(contract.id, { seed: contract.seed, chapter: contract.chapter }), rules: clone(rules) };
  return result;
}

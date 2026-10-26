/** Data only: layout, reachability, collision and action rendering belong to the game world. */
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

const items = (prefix, count, kind = 'data', optional = false) =>
  Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i + 1}`, kind, optional }));

export const RULES = freeze({
  maxHealth: 100,
  damage: 20,
  damageProtectionMs: 700,
  backpackCapacity: 3,
  qualifierCapacity: 5,
  aiTokenCapacity: 12,
  aiTokenDefaultCost: 1,
  aiTokenPreciseCost: 2,
  aiTokenSupply: 1,
  deliveryOpenMs: 400,
  deliveryClosedMs: 1600,
  broadcastInteractionMs: 800,
  commandAlert: 4,
  deliveryAlert: 8,
  alarmAlert: 10,
  alarmSourceCooldownMs: 2000,
  finalEvacuationMs: 60_000,
  teammates: ['Grok', 'Claude', 'GLM'],
  cooldownMs: { Grok: 6000, Claude: 8000, GLM: 8000 },
});

export const CHAPTERS = freeze([
  {
    id: 'paper-window', number: 1, name: '纸窗入港', targetMinutes: 3,
    qualifiers: 2, baseAlert: 0, teammates: ['Grok'],
    requiredItems: items('harbor-data', 4),
    optionalItems: items('harbor-extra', 2, 'data', true),
    supplies: [{ id: 'harbor-qualifier', qualifiers: 1, aiTokens: 2 }],
    commandTargets: [
      { id: 'paper-window', teammate: 'Grok', effect: 'break-obstacle', collaboration: true },
      { id: 'outer-node', teammate: 'Grok', effect: 'break-obstacle', collaboration: true },
    ],
    requiredTargetGroups: [['paper-window']],
    requiredMechanic: 'effective-command',
  },
  {
    id: 'resume-storm', number: 2, name: '简历风波', targetMinutes: 4,
    qualifiers: 3, baseAlert: 0, teammates: ['Grok', 'Claude'],
    requiredItems: items('resume-data', 6),
    optionalItems: items('resume-extra', 2, 'data', true),
    supplies: [{ id: 'resume-qualifier', qualifiers: 1, aiTokens: 2 }],
    commandTargets: [
      { id: 'patrol-east', teammate: 'Claude', effect: 'change-patrol', collaboration: true },
      { id: 'cargo-divider', teammate: 'Grok', effect: 'break-obstacle', collaboration: true },
      { id: 'patrol-west', teammate: 'Claude', effect: 'change-patrol', collaboration: false },
    ],
    // Either the focused east lure or the physical divider route demonstrates
    // the chapter's key decision; the west lure remains an optional variant.
    requiredTargetGroups: [['patrol-east', 'cargo-divider']],
    requiredMechanic: 'changed-patrol',
  },
  {
    id: 'review-quietly', number: 3, name: '复查勿扰', targetMinutes: 4,
    qualifiers: 4, baseAlert: 0, teammates: ['Grok', 'Claude', 'GLM'],
    requiredItems: items('review-data', 6),
    optionalItems: items('review-extra', 2, 'data', true),
    supplies: [
      { id: 'review-qualifier-a', qualifiers: 1, aiTokens: 2 },
      { id: 'review-qualifier-b', qualifiers: 1, aiTokens: 2 },
    ],
    commandTargets: [
      { id: 'trap-bridge', teammate: 'GLM', effect: 'review-traps', collaboration: true },
      { id: 'return-divider', teammate: 'Grok', effect: 'break-obstacle', collaboration: true },
      { id: 'alarm-fan', teammate: 'GLM', effect: 'review-traps', collaboration: false },
    ],
    // Scanning the bridge or opening the return divider are equivalent main
    // routes. The high alarm fan remains an optional mastery action.
    requiredTargetGroups: [['trap-bridge', 'return-divider']],
    requiredMechanic: 'completed-review',
  },
  {
    id: 'public-report', number: 4, name: '战报公开', targetMinutes: 5,
    qualifiers: 4, baseAlert: 0, teammates: ['Grok', 'Claude', 'GLM'],
    requiredItems: items('report-task', 2, 'task-item'),
    optionalItems: items('report-archive', 2, 'archive', true),
    supplies: [
      { id: 'report-qualifier-a', qualifiers: 1, aiTokens: 2 },
      { id: 'report-qualifier-b', qualifiers: 1, aiTokens: 2 },
    ],
    commandTargets: [
      { id: 'archive-divider', teammate: 'Grok', effect: 'break-obstacle', collaboration: true },
      { id: 'return-inspection', teammate: 'GLM', effect: 'review-traps', collaboration: true },
      { id: 'archive-guard', teammate: 'Claude', effect: 'change-patrol', collaboration: false },
    ],
    requiredMechanic: 'broadcast-off-and-beacon',
  },
  {
    id: 'close-hatch', number: 5, name: '闭舱返航', targetMinutes: 4,
    qualifiers: 3, baseAlert: 0, teammates: ['Grok', 'Claude', 'GLM'],
    requiredItems: items('final-data', 3), optionalItems: [],
    supplies: [
      { id: 'rendezvous-supply-a', qualifiers: 1, aiTokens: 2, optionalObjective: true },
      { id: 'rendezvous-supply-b', qualifiers: 1, aiTokens: 2, optionalObjective: true },
    ],
    commandTargets: [
      { id: 'evacuation-divider', teammate: 'Grok', effect: 'break-obstacle', collaboration: true },
      { id: 'evacuation-patrol', teammate: 'Claude', effect: 'change-patrol', collaboration: true },
      { id: 'evacuation-traps', teammate: 'GLM', effect: 'review-traps', collaboration: false },
    ],
    requiredMechanic: 'remote-rendezvous-and-evacuation',
    rendezvousTarget: 'remote-return-beacon',
  },
]);

export const STORY_FLAGS = freeze(['briefing-published', 'broadcast-discovered', 'return-beacon-ready']);
export const getChapter = (id) => CHAPTERS.find((chapter) => chapter.id === id) ?? null;
export const chapterGrade = (score) => score >= 90 ? 'S' : score >= 75 ? 'A' : 'B';
export const campaignGrade = (score) => score >= 450 ? 'S' : score >= 360 ? 'A' : 'B';

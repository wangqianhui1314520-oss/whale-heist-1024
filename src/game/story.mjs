/** Local story data. Reading a scene never commits world effects or manufactures events. */
const clone = value => JSON.parse(JSON.stringify(value));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
// `motion` is intentionally data-only: the UI can turn these hints into
// lightweight CSS animation without changing story state or save data.
const step = (speaker, text, pose = 'idle', backdrop = 'boat-interior', duration = 4, motion = {}) => ({ speaker, text, pose, backdrop, duration, motion, choice: motion.choice || null });
const scene = (id, title, chapter, steps, extra = {}) => ({ id, title, chapter, steps, duration: steps.reduce((n, s) => n + s.duration, 0), events: [], ...extra });

export const STORY_SCENES = freeze({
  departure: scene('departure', '出航 · 纸窗入港', 1, [
    step('DeepSeek', '第一单：带回四份资料。先从码头的小梯子出发。', 'point', 'story-prologue', 4, { camera: 'push-in', enter: 'slide-right', fx: ['beacon'] }),
    step('Grok', '你能冲开蓝色节点，纸窗交给我！背包满三格，记得回艇交付。', 'ready', 'harbor-dock', 4, { camera: 'hold', enter: 'fade', fx: ['water'] }),
  ], { requiresStart: true }),
  // Interactive opening (30 seconds of animation plus the player's choices).
  // The choices are
  // deliberately about observation and coordination inside the fictional map;
  // they never describe real hosts, credentials, commands or exploit steps.
  prologue: scene('prologue', '序章 · 深海广播', 1, [
    step('DeepSeek', '收到异常广播。先看清记录、警报和回程路。', 'surprised', 'story-prologue', 4, { camera: 'push-in', enter: 'slide-right', fx: ['alert', 'beacon'] }),
    step('记录屏', '摘录已生成：入口、巡逻、资料舱和信标都在这张虚构图上。不会连接外部服务器。', 'record', 'record-screen', 4, { camera: 'scan', enter: 'card', fx: ['record', 'scan'] }),
    step('小队', 'Grok 破障，Claude 诱导，GLM 扫描。DeepSeek 观察、发令，最后确认撤离。', 'ready', 'boat-interior', 4, { camera: 'pan-left', enter: 'pop-left', fx: ['page', 'beacon'] }),
    step('DeepSeek', '先观察入口、警戒器和回程路。', 'point', 'story-prologue', 3, { camera: 'push-in', enter: 'slide-right', fx: ['scan'], choice: { prompt: '第一步 · 观察', options: [{ id: 'observe', label: '观察', hint: '标出入口和安全回程路。' }] } }),
    step('DeepSeek', '观察完成。节点、巡逻和信标已标出。下一步，写清楚指令。', 'scan', 'harbor-server', 3, { camera: 'scan', enter: 'fade', fx: ['scan', 'beacon'] }),
    step('DeepSeek', '选队友、选目标，再说清范围和停止位置。', 'map', 'harbor-server', 3, { camera: 'pan-right', enter: 'slide-right', fx: ['page'], choice: { prompt: '第二步 · 发令', options: [{ id: 'issue', label: '发令', hint: '让队友执行当前目标。' }] } }),
    step('小队', '行动卡：观察 → 协作 → 收集 → 返航。每次行动留回执，并消耗 AI Token。', 'nod', 'record-screen', 4, { camera: 'hold', enter: 'card', fx: ['record', 'beacon'] }),
    step('DeepSeek', '最后确认撤离。资料和队友都要回艇。', 'point', 'rendezvous-front', 3, { camera: 'push-in', enter: 'slide-right', fx: ['water', 'beacon'], choice: { prompt: '第三步 · 撤离', options: [{ id: 'evacuate', label: '撤离', hint: '把回程也算进计划。' }] } }),
    step('DeepSeek', '准备完成。点击“开始行动”，从码头出发。', 'point', 'harbor-dock', 2, { camera: 'push-in', enter: 'fade', fx: ['beacon'] }),
  ], { events: ['story:prologue-seen'], requiredChoices: ['observe', 'issue', 'evacuate'], autoDuration: 30 }),
  'chapter1-briefing': scene('chapter1-briefing', '第一章 · 纸窗入港', 1, [
    step('DeepSeek', '搬回四份资料。先练习，再让 Grok 破窗。', 'point', 'harbor-dock'),
    step('Grok', '装满三格就回艇。默认方案省限定词；精确方案更可控，但会多花资源。', 'ready', 'harbor-server', 6),
  ]),
  'grok-join': scene('grok-join', 'Grok · 第一次协作', 1, [
    step('Grok', '纸窗开了，电力也恢复。你定目标，我来开路。', 'ready', 'story-grok', 4, { camera: 'impact', enter: 'pop-left', fx: ['impact', 'water'] }),
    step('DeepSeek', '破障完成。带上资料，沿新桥回艇。', 'point', 'harbor-dock', 3, { camera: 'pan-left', enter: 'slide-right', fx: ['record', 'beacon'] }),
  ], { events: ['story:grok-joined'] }),
  'claude-join': scene('claude-join', 'Claude 加入', 2, [
    step('Claude', '简历投放。默认会引开同层多人；加限定词，只引一人。', 'resume', 'recruitment-hall', 4, { camera: 'pan-left', enter: 'slide-left', fx: ['page', 'decoy'] }),
    step('DeepSeek', '先在安全区试一次，再选通道。', 'nod', 'recruitment-hall', 3, { camera: 'hold', enter: 'fade', fx: ['beacon'] }),
  ], { events: ['story:claude-joined'] }),
  'chapter2-briefing': scene('chapter2-briefing', '第二章 · 简历风波', 2, [
    step('Claude', '先看两组巡逻。默认引开多人；精确方案只动一人。', 'point', 'recruitment-hall'),
    step('DeepSeek', '带回六份资料。训练限定词不占正式预算。', 'map', 'sorting-room'),
  ]),
  'glm-join': scene('glm-join', 'GLM 加入', 3, [
    step('GLM', '开始扫描。能看见陷阱，但广域扫描可能惊动警戒器。', 'scan', 'inspection-bridge', 4, { camera: 'scan', enter: 'slide-right', fx: ['scan'] }),
    step('DeepSeek', '先看范围。安全长路一直可走，不必花限定词。', 'point', 'inspection-bridge', 3, { camera: 'hold', enter: 'fade', fx: ['beacon'] }),
  ], { events: ['story:glm-joined'] }),
  'chapter3-briefing': scene('chapter3-briefing', '第三章 · 复查勿扰', 3, [
    step('GLM', '带回六份资料。先查校验桥，再选长路或近路。', 'scan', 'inspection-bridge'),
    step('DeepSeek', '警戒会先预警。升降台之外，还有梯路可返。', 'point', 'audit-pipes'),
  ]),
  'chapter4-briefing': scene('chapter4-briefing', '第四章 · 战报公开', 4, [
    step('DeepSeek', '带回两份档案，检查广播，再设好远端信标。', 'map', 'broadcast-room'),
    step('GLM', '关广播只停新增，已经公开的记录仍会保留。', 'serious', 'broadcast-room'),
  ]),
  'chapter4-reveal': scene('chapter4-reveal', '战报成为线索', 4, [], { dynamic: 'broadcast', events: ['story:broadcast-discovered'] }),
  'chapter5-briefing': scene('chapter5-briefing', '第五章 · 闭舱返航', 5, [
    step('DeepSeek', '先看返程，再去远端装载三份资料，让队友集结。', 'map', 'rendezvous-front'),
    step('Claude', '补给现在可取。确认撤离后，支线会封存。', 'point', 'rendezvous-front'),
  ]),
  'chapter5-preparation': scene('chapter5-preparation', '最后出航之前', 5, [], { dynamic: 'preparation' }),
  epilogue: scene('epilogue', '调查笔录', 5, [], { dynamic: 'epilogue', events: ['story:epilogue-seen'] }),
});

export const STORY_REPLAY_INDEX = freeze(Object.values(STORY_SCENES).map(({ id, title, chapter, duration }) => ({ id, title, chapter, duration })));
const ALIASES = { intro: 'prologue', 'claude-intro': 'claude-join', 'glm-intro': 'glm-join', 'chapter4-twist': 'chapter4-reveal', 'final-preparation': 'chapter5-preparation', ending: 'epilogue' };
for (let n = 1; n <= 5; n++) { ALIASES[`chapter-${n}`] = `chapter${n}-briefing`; ALIASES[`briefing-${n}`] = `chapter${n}-briefing`; }
const actualRecords = context => {
  const source = context.records ?? context.attempt?.records ?? context.campaign?.records ?? [];
  if (!Array.isArray(source)) return [];
  return source.filter(record => record && typeof record === 'object').map((record, index) => ({
    ...record, ...record.payload, id: String(record.id ?? record.eventId ?? record.commandId ?? `record-${index}`),
    type: record.type ?? record.payload?.type ?? 'event',
  }));
};
const clock = record => {
  const seconds = Number.isFinite(record.elapsedMs) ? record.elapsedMs / 1000 : Number.isFinite(record.time) ? record.time : null;
  return seconds === null ? '' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')} `;
};
const recordText = record => {
  const prefix = clock(record);
  if (record.promptText || record.text) return `${prefix}${record.teammate ? `${record.teammate}：` : ''}${String(record.promptText ?? record.text)}`;
  if (/command|receipt/.test(record.type)) return `${prefix}${record.teammate ?? '队友'} → ${record.targetId ?? '已登记目标'}${record.outcome ? `：${record.outcome}` : ''}`;
  if (/delivery/.test(record.type)) return `${prefix}完成交付${Number.isFinite(record.count) ? ` ${record.count} 份` : ''}${record.itemIds?.length ? `（${record.itemIds.join('、')}）` : ''}`;
  if (/alarm/.test(record.type)) return `${prefix}警报来源：${record.sourceId ?? record.source ?? '记录未注明'}`;
  if (/rendezvous/.test(record.type)) return `${prefix}${record.teammate ?? '队友'}在信标集结`;
  if (/evacuation/.test(record.type)) return `${prefix}${/confirm|start/.test(record.type) ? '已主动确认撤离' : '撤离事件'}`;
  if (record.type === 'broadcast-leak') return `${prefix}公开广播持续外泄`;
  if (/broadcast/.test(record.type)) return `${prefix}公开广播${record.on === false || record.broadcastOn === false ? '关闭' : record.on === true || record.broadcastOn === true ? '开启' : '状态更新'}`;
  return `${prefix}${record.outcome ?? record.label ?? record.type}`;
};

/** Context may be a GameCore view plus records. Timings are seconds; all returned data is detached. */
export function getStoryScene(id, context = {}) {
  const source = STORY_SCENES[ALIASES[id] ?? id];
  if (!source) return null;
  const result = clone(source), attempt = context.attempt ?? {}, campaign = context.campaign ?? {};
  const broadcastOn = context.broadcastOn ?? attempt.broadcastOn ?? campaign.broadcastOn ?? true;
  const records = actualRecords(context);
  const archive = records.map(record => ({ id: record.id, type: record.type, text: recordText(record), public: record.public === true || record.broadcastOn === true || record.published === true }));
  result.archive = archive;
  result.sourceRecordIds = [];
  const quote = (entries, backdrop, duration) => entries.map(record => {
    result.sourceRecordIds.push(record.id);
    return { ...step('记录屏', record.text, 'record', backdrop, duration, { camera: 'hold', enter: 'card', fx: ['record'] }), recordId: record.id };
  });
  if (source.dynamic === 'broadcast') {
    const publicRecords = archive.filter(record => record.public).slice(-2);
    const localRecords = publicRecords.length ? publicRecords : archive.slice(-2);
    result.branch = broadcastOn ? 'broadcast-on' : 'broadcast-off';
    result.steps = [
      step('DeepSeek', broadcastOn ? '广播还亮着。我们的战报，外面看得到。' : '广播已提前关闭。新战报不再发布，旧记录仍在。', 'surprised', 'story-broadcast', 5, { camera: 'alert', enter: 'slide-right', fx: [broadcastOn ? 'alert' : 'beacon'] }),
      ...(localRecords.length ? quote(localRecords, 'story-broadcast', 3) : [step('记录屏', '没有可核验记录。这里不补写指令。', 'record', 'story-broadcast', 4, { camera: 'hold', enter: 'card', fx: ['record'] })]),
      step('GLM', publicRecords.length ? '这些是本次已公开记录。关广播停新增，旧记录仍保留。' : '当前只核对艇内记录；状态不明的不算已泄露。', 'serious', 'record-screen', 4, { camera: 'scan', enter: 'card', fx: ['scan', 'record'] }),
      step('DeepSeek', broadcastOn ? '先关广播，再取档案、设信标。回程也要安排。' : '提前关闭起作用了。保持关闭，继续取档案、设信标。', 'point', 'story-broadcast', 3, { camera: 'push-in', enter: 'slide-right', fx: ['beacon'] }),
    ];
  } else if (source.dynamic === 'preparation') {
    const crew = context.rendezvousCrew ?? attempt.rendezvousCrew ?? [];
    const ready = context.remoteReady ?? attempt.remoteReady ?? false;
    const started = context.evacuationStarted ?? attempt.evacuationStarted ?? false;
    const preparationRecords = archive.filter(record => /rendezvous|remote-prepare|evacuation/.test(record.type)).slice(-1);
    result.branch = started ? 'started' : ready && crew.length === 3 ? 'ready' : 'preparing';
    result.steps = [
      step('DeepSeek', `远端集结：${crew.length}/3。${ready ? '接应装载已完成。' : '接应装载尚未完成。'}`, 'map', 'story-evacuation', 3, { camera: ready ? 'impact' : 'push-in', enter: 'slide-right', fx: [ready ? 'beacon' : 'page'] }),
      ...quote(preparationRecords, 'story-evacuation', 2),
      step('GLM', started ? '撤离已确认。现在返艇、交付、登艇。' : '六十秒撤离尚未开始。准备好后，在远端信标确认。', 'point', 'story-evacuation', preparationRecords.length ? 3 : 4, { camera: started ? 'alert' : 'hold', enter: 'fade', fx: [started ? 'alert' : 'beacon'] }),
    ];
  } else if (source.dynamic === 'epilogue') {
    const results = context.results ?? campaign.results ?? [];
    const eventSum = key => results.reduce((sum, item) => sum + (Number.isFinite(item.events?.[key]) ? item.events[key] : 0), 0);
    const actual = archive.filter(record => /command|receipt|delivery|alarm|rendezvous|evacuation/.test(record.type)).slice(-2);
    const total = results.reduce((sum, item) => sum + (Number.isFinite(item.score) ? item.score : 0), 0);
    const complete = context.completed ?? campaign.completed ?? false;
    result.branch = complete ? 'campaign-complete' : 'journey-record';
    result.steps = [
      step('调查笔录', `已确认 ${results.length} 章，合计 ${total} 分。${complete ? '航程完成。' : '航程继续。'}`, 'record', 'story-epilogue', 4, { camera: 'push-in', enter: 'card', fx: ['record'] }),
      ...(actual.length ? quote(actual, 'story-epilogue', 3) : [step('调查笔录', '没有可核验记录，保留章节汇总。', 'record', 'story-epilogue', 4, { camera: 'hold', enter: 'card', fx: ['record'] })]),
      step('GLM', `章节汇总：公开指令 ${eventSum('publicCommands')} 次，交付 ${eventSum('publicDeliveries')} 次，报警 ${eventSum('alarms')} 次。`, 'serious', 'story-epilogue', 4, { camera: 'scan', enter: 'card', fx: ['scan', 'record'] }),
      step('DeepSeek', broadcastOn ? '广播仍开着。这会写入笔录。' : '广播已关闭。旧记录保留，不再新增。', 'nod', 'boat-interior', 3, { camera: 'impact', enter: 'fade', fx: ['beacon'] }),
    ];
  }
  // Timings describe the actual animation; mandatory choices wait for input.
  result.duration = Number.isFinite(source.durationOverride) ? source.durationOverride : result.steps.reduce((sum, entry) => sum + entry.duration, 0);
  if (Number.isFinite(source.autoDuration)) result.autoDuration = source.autoDuration;
  return result;
}

export function getStoryReplayIndex(context = {}) {
  const seen = context.seenScenes ?? context.storySeen ?? [];
  return STORY_REPLAY_INDEX.map(entry => ({ ...entry, duration: getStoryScene(entry.id, context).duration, seen: seen.includes(entry.id) }));
}

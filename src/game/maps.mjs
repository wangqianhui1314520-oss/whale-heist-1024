/**
 * Fixed-camera side-view maps. Coordinates are logical pixels in a 1280×720 view.
 * Actors, items and interaction points use feet/baseline y; rectangles use top y.
 * Ladder x is its centre, y is its top. Lift period is measured in seconds.
 * Collision platforms deliberately exclude decorative supports and artwork.
 */
const platform = (id, x, y, w, kind = 'stone', extra = {}) =>
  ({ id, x, y, w, h: kind === 'thin' ? 14 : kind === 'lift' ? 18 : 20, kind, ...extra });
const ladder = (id, x, y, h) => ({ id, x, y, h });
const barrier = (id, x, baseY, w = 44, h = 76) =>
  ({ id, x, y: baseY - h, w, h, targetId: id, breakable: true });
const item = (id, x, y, optional = false, kind = 'data') => ({ id, x, y, optional, kind });
const target = (id, teammate, x, y, label, effect) => ({ id, teammate, x, y, label, effect });
const map = (data) => ({
  spawn: { x: 120, y: 600 },
  boat: { x: 85, y: 600 },
  broadcast: { x: 235, y: 600 },
  ladders: [], barriers: [], gates: [], plates: [], items: [], supplies: [],
  targets: [], guards: [], traps: [], alarms: [], decoration: [],
  ...data,
});

export const MAPS = [
  map({
    id: 'paper-window',
    name: '纸窗入港',
    subtitle: '越过纸窗，学会让小队开路。',
    tint: '#084d70',
    beacon: { x: 1100, y: 380 },
    platforms: [
      platform('floor', 0, 600, 1280),
      platform('west-pier', 175, 490, 340),
      platform('cargo-walk', 590, 490, 330),
      platform('archive-perch', 290, 380, 330),
      platform('outer-gallery', 830, 380, 340),
      platform('bonus-bridge', 590, 270, 330, 'thin'),
    ],
    ladders: [
      ladder('west-access', 240, 490, 110),
      ladder('cargo-access', 650, 490, 110),
      ladder('archive-access', 340, 380, 110),
      ladder('outer-access', 985, 380, 220),
      ladder('bonus-access', 650, 270, 220),
      ladder('bonus-return', 860, 270, 110),
    ],
    barriers: [
      barrier('paper-window', 420, 490),
      barrier('outer-node', 960, 380),
    ],
    items: [
      item('harbor-data-1', 330, 490),
      item('harbor-data-2', 485, 490),
      item('harbor-data-3', 710, 490),
      item('harbor-data-4', 1060, 380),
      item('harbor-extra-1', 555, 380, true),
      item('harbor-extra-2', 800, 270, true),
    ],
    supplies: [{ id: 'harbor-qualifier', x: 575, y: 380 }],
    targets: [
      target('paper-window', 'Grok', 442, 490, '撞开纸窗', 'break-obstacle'),
      target('outer-node', 'Grok', 982, 380, '撞开外侧节点', 'break-obstacle'),
    ],
    guards: [
      { id: 'harbor-guard', x: 1080, y: 380, minX: 1020, maxX: 1140, speed: 46 },
    ],
    traps: [],
    alarms: [{ id: 'harbor-alarm', x: 900, y: 490 }],
    decoration: [
      { id: 'harbor-server', x: 28, y: 470, w: 52, h: 130, asset: 'scene-server-rack' },
    ],
  }),
  map({
    id: 'resume-storm',
    name: '简历风波',
    subtitle: '用纸页调开巡逻，选择两条回程。',
    tint: '#183e6b',
    beacon: { x: 1080, y: 380 },
    platforms: [
      platform('floor', 0, 600, 1280),
      platform('west-pier', 160, 490, 290),
      platform('sorting-walk', 505, 490, 320),
      platform('east-pier', 885, 490, 310),
      platform('west-study', 270, 380, 340),
      platform('east-study', 730, 380, 390),
      platform('document-bridge', 480, 270, 430, 'thin'),
    ],
    ladders: [
      ladder('west-access', 210, 490, 110),
      ladder('sorting-access', 570, 490, 110),
      ladder('east-access', 1110, 490, 110),
      ladder('west-study-access', 330, 380, 110),
      ladder('east-study-west', 780, 380, 110),
      ladder('east-study-east', 1050, 380, 110),
      ladder('bridge-west', 550, 270, 110),
      ladder('bridge-east', 850, 270, 110),
    ],
    barriers: [barrier('cargo-divider', 640, 490)],
    gates: [{ id: 'sorting-gate', x: 790, y: 418, w: 30, h: 72, plateId: 'east-pressure' }],
    plates: [{ id: 'east-pressure', x: 1005, y: 374, w: 54, h: 6, gateId: 'sorting-gate' }],
    items: [
      item('resume-data-1', 245, 490),
      item('resume-data-2', 420, 490),
      item('resume-data-3', 560, 490),
      item('resume-data-4', 755, 490),
      item('resume-data-5', 810, 380),
      item('resume-data-6', 1070, 380),
      item('resume-extra-1', 490, 380, true),
      item('resume-extra-2', 800, 270, true),
    ],
    supplies: [{ id: 'resume-qualifier', x: 570, y: 270 }],
    targets: [
      target('patrol-east', 'Claude', 990, 380, '调开东侧巡逻', 'change-patrol'),
      target('cargo-divider', 'Grok', 662, 490, '撞开货物隔板', 'break-obstacle'),
      target('patrol-west', 'Claude', 350, 490, '调开西侧巡逻', 'change-patrol'),
    ],
    guards: [
      { id: 'resume-east-guard', x: 960, y: 380, minX: 760, maxX: 1090, speed: 54 },
      { id: 'resume-west-guard', x: 350, y: 490, minX: 180, maxX: 425, speed: 42 },
    ],
    traps: [{ id: 'resume-floor-trap', x: 725, y: 592, w: 75 }],
    alarms: [{ id: 'resume-alarm', x: 1150, y: 490 }],
    decoration: [
      { id: 'resume-server-west', x: 28, y: 470, w: 52, h: 130, asset: 'scene-server-rack' },
      { id: 'resume-server-east', x: 1215, y: 475, w: 46, h: 125, asset: 'scene-server-rack' },
    ],
  }),
  map({
    id: 'review-quietly',
    name: '复查勿扰',
    subtitle: '先扫描，再选近路；高处藏着额外档案。',
    tint: '#243c70',
    beacon: { x: 1060, y: 170 },
    platforms: [
      platform('floor', 0, 600, 1280),
      platform('west-pier', 130, 490, 350),
      platform('centre-pier', 560, 490, 320),
      platform('east-pier', 960, 490, 260),
      platform('west-review', 240, 380, 300),
      platform('trap-bridge-platform', 610, 380, 330),
      platform('east-review', 1020, 380, 180),
      platform('upper-route', 430, 270, 450, 'thin'),
      platform('lookout', 760, 170, 380, 'thin'),
      platform('review-lift', 485, 490, 70, 'lift', { minY: 380, maxY: 490, period: 6 }),
    ],
    ladders: [
      ladder('west-access', 210, 490, 110),
      ladder('centre-access', 640, 490, 110),
      ladder('east-access', 1100, 490, 110),
      ladder('west-review-access', 330, 380, 110),
      ladder('trap-bridge-access', 740, 380, 110),
      ladder('east-review-access', 1100, 380, 110),
      ladder('upper-west', 480, 270, 110),
      ladder('upper-east', 800, 270, 110),
      ladder('lookout-west', 825, 170, 100),
      ladder('lookout-return', 1080, 170, 210),
    ],
    barriers: [barrier('return-divider', 785, 490)],
    items: [
      item('review-data-1', 290, 490),
      item('review-data-2', 680, 490),
      item('review-data-3', 1110, 490),
      item('review-data-4', 390, 380),
      item('review-data-5', 850, 380),
      item('review-data-6', 975, 170),
      item('review-extra-1', 550, 270, true),
      item('review-extra-2', 1140, 380, true),
    ],
    supplies: [
      { id: 'review-qualifier-a', x: 470, y: 380 },
      { id: 'review-qualifier-b', x: 1080, y: 170 },
    ],
    targets: [
      target('trap-bridge', 'GLM', 780, 380, '复查陷阱桥', 'review-traps'),
      target('return-divider', 'Grok', 807, 490, '打开回程隔板', 'break-obstacle'),
      target('alarm-fan', 'GLM', 1015, 170, '复查高处警戒区', 'review-traps'),
    ],
    guards: [
      { id: 'review-east-guard', x: 1055, y: 490, minX: 985, maxX: 1190, speed: 48 },
      { id: 'review-upper-guard', x: 620, y: 270, minX: 460, maxX: 850, speed: 52 },
    ],
    traps: [
      { id: 'review-bridge-trap', x: 680, y: 372, w: 70 },
      { id: 'review-west-trap', x: 425, y: 372, w: 65 },
      { id: 'review-floor-trap', x: 900, y: 592, w: 65 },
    ],
    alarms: [
      { id: 'review-upper-alarm', x: 1100, y: 170 },
      { id: 'review-floor-alarm', x: 930, y: 600 },
    ],
    decoration: [
      { id: 'review-server', x: 25, y: 470, w: 52, h: 130, asset: 'scene-server-rack' },
    ],
  }),
  map({
    id: 'public-report',
    name: '战报公开',
    subtitle: '关闭母舰广播，前往远端信标回收任务物。',
    tint: '#402951',
    beacon: { x: 1100, y: 270 },
    platforms: [
      platform('floor', 0, 600, 1280),
      platform('west-pier', 155, 490, 340),
      platform('centre-pier', 555, 490, 350),
      platform('east-pier', 975, 490, 260),
      platform('west-archive', 270, 380, 340),
      platform('east-inspection', 730, 380, 430),
      platform('archive-route', 390, 270, 350),
      platform('beacon-terrace', 860, 270, 360),
      platform('high-return', 625, 190, 345, 'thin'),
      platform('archive-lift', 630, 380, 75, 'lift', { minY: 270, maxY: 490, period: 7 }),
    ],
    ladders: [
      ladder('west-access', 215, 490, 110),
      ladder('centre-access', 620, 490, 110),
      ladder('east-access', 1100, 490, 110),
      ladder('west-archive-access', 350, 380, 110),
      ladder('east-inspection-west', 820, 380, 110),
      ladder('east-inspection-east', 1090, 380, 110),
      ladder('archive-route-access', 500, 270, 110),
      ladder('beacon-access', 1080, 270, 110),
      ladder('high-return-west', 690, 190, 80),
      ladder('high-return-east', 915, 190, 80),
    ],
    barriers: [barrier('archive-divider', 590, 270)],
    gates: [{ id: 'archive-gate', x: 990, y: 198, w: 30, h: 72, plateId: 'inspection-pressure' }],
    plates: [{ id: 'inspection-pressure', x: 795, y: 374, w: 54, h: 6, gateId: 'archive-gate' }],
    items: [
      item('report-task-1', 690, 270, false, 'task-item'),
      item('report-task-2', 1160, 270, false, 'task-item'),
      item('report-archive-1', 545, 380, true, 'archive'),
      item('report-archive-2', 850, 190, true, 'archive'),
    ],
    supplies: [
      { id: 'report-qualifier-a', x: 420, y: 490 },
      { id: 'report-qualifier-b', x: 1010, y: 380 },
    ],
    targets: [
      target('archive-divider', 'Grok', 612, 270, '撞开档案隔板', 'break-obstacle'),
      target('return-inspection', 'GLM', 1040, 380, '复查返航通道', 'review-traps'),
      target('archive-guard', 'Claude', 1070, 270, '调开档案巡逻', 'change-patrol'),
    ],
    guards: [
      { id: 'report-archive-guard', x: 1080, y: 270, minX: 1035, maxX: 1190, speed: 52 },
      { id: 'report-centre-guard', x: 740, y: 490, minX: 585, maxX: 875, speed: 50 },
    ],
    traps: [
      { id: 'report-return-trap', x: 1020, y: 372, w: 68 },
      { id: 'report-low-trap', x: 925, y: 592, w: 64 },
    ],
    alarms: [
      { id: 'report-archive-alarm', x: 700, y: 270 },
      { id: 'report-beacon-alarm', x: 1200, y: 270 },
    ],
    decoration: [
      { id: 'report-server', x: 27, y: 470, w: 52, h: 130, asset: 'scene-server-rack' },
      { id: 'report-high-server', x: 285, y: 290, w: 42, h: 90, asset: 'scene-server-rack' },
    ],
  }),
  map({
    id: 'close-hatch',
    name: '闭舱返航',
    subtitle: '带齐三块数据，在远端接应，再赶回母舰。',
    tint: '#16435e',
    beacon: { x: 1100, y: 270 },
    platforms: [
      platform('floor', 0, 600, 1280),
      platform('west-pier', 170, 490, 320),
      platform('centre-pier', 560, 490, 340),
      platform('east-pier', 980, 490, 250),
      platform('west-return', 280, 380, 330),
      platform('east-return', 735, 380, 440),
      platform('upper-return', 420, 270, 340),
      platform('beacon-terrace', 860, 270, 360),
      platform('high-resupply', 620, 170, 360, 'thin'),
      platform('evacuation-lift', 770, 380, 80, 'lift', { minY: 270, maxY: 490, period: 7 }),
    ],
    ladders: [
      ladder('west-access', 220, 490, 110),
      ladder('centre-access', 650, 490, 110),
      ladder('east-access', 1100, 490, 110),
      ladder('west-return-access', 350, 380, 110),
      ladder('east-return-west', 810, 380, 110),
      ladder('east-return-east', 1100, 380, 110),
      ladder('upper-return-access', 530, 270, 110),
      ladder('beacon-access', 1100, 270, 110),
      ladder('high-resupply-west', 700, 170, 100),
      ladder('high-resupply-east', 930, 170, 100),
    ],
    barriers: [barrier('evacuation-divider', 910, 270)],
    gates: [{ id: 'evacuation-gate', x: 785, y: 418, w: 30, h: 72, plateId: 'return-pressure' }],
    plates: [{ id: 'return-pressure', x: 505, y: 264, w: 54, h: 6, gateId: 'evacuation-gate' }],
    items: [
      item('final-data-1', 1040, 270),
      item('final-data-2', 1120, 270),
      item('final-data-3', 1180, 270),
    ],
    supplies: [
      { id: 'rendezvous-supply-a', x: 485, y: 380 },
      { id: 'rendezvous-supply-b', x: 860, y: 170 },
    ],
    targets: [
      target('evacuation-divider', 'Grok', 932, 270, '清除接应隔板', 'break-obstacle'),
      target('evacuation-patrol', 'Claude', 1150, 270, '调开撤离巡逻', 'change-patrol'),
      target('evacuation-traps', 'GLM', 910, 380, '复查撤离机关', 'review-traps'),
    ],
    guards: [
      { id: 'evacuation-upper-guard', x: 1145, y: 270, minX: 1000, maxX: 1200, speed: 58 },
      { id: 'evacuation-return-guard', x: 1080, y: 380, minX: 950, maxX: 1150, speed: 54 },
    ],
    traps: [
      { id: 'evacuation-return-trap', x: 860, y: 372, w: 70 },
      { id: 'evacuation-floor-trap', x: 730, y: 592, w: 80 },
    ],
    alarms: [
      { id: 'evacuation-east-alarm', x: 1205, y: 270 },
      { id: 'evacuation-high-alarm', x: 650, y: 170 },
    ],
    decoration: [
      { id: 'evacuation-server', x: 25, y: 470, w: 52, h: 130, asset: 'scene-server-rack' },
    ],
  }),
];

export const getMap = (id) => MAPS.find((entry) => entry.id === id) ?? null;

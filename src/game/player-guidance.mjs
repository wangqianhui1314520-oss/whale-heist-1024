/** Read-only next-action guidance. Inventory and world receipts remain authoritative. */
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function playerGuidance(world, view) {
  const { chapter, attempt: a } = view;
  if (!chapter || !a) return null;
  const rooms = world.expanded ? world.rooms : [world.map];
  const current = world.currentRoom || world.map;
  const state = room => room.id === current.id ? world : world.roomStates?.[room.id] || room;
  const required = new Set(chapter.requiredItems.map(item => item.id));
  const carried = a.inventory.filter(id => required.has(id));
  const delivered = a.deliveredIds.filter(id => required.has(id)).length;
  const missing = chapter.requiredItems.filter(item => !a.inventory.includes(item.id) && !a.deliveredIds.includes(item.id));
  const progress = `已交付 ${delivered}/${required.size} · 背包 ${a.inventory.length}/3`;
  const boatRoom = rooms.find(room => room.boat) || current;
  const beaconRoom = rooms.find(room => room.beacon) || current;
  const at = (room, point, label, hint = '', extra = {}) => {
    let target = point, local = room.id === current.id;
    if (!local) {
      // Follow actual exits, including one-way and event-gated connections.
      const queue = [{ room: current, first: null }], seen = new Set([current.id]);
      target = null;
      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        if (entry.room.id === room.id) { target = entry.first; break; }
        for (const exit of [...(entry.room.exits || [])].sort((x,y) => near(x, world.player) - near(y, world.player))) {
          if (exit.disabled || seen.has(exit.to) || exit.requiresEvent && !world.eventFlags?.has(exit.requiresEvent)) continue;
          const next = rooms.find(candidate => candidate.id === exit.to);
          if (!next || next.optional && a.evacuationStarted) continue;
          seen.add(next.id); queue.push({ room: next, first: entry.first || exit });
        }
      }
    }
    return { label, hint: local ? hint : `前往${room.name} · 从标记的出口换房`, progress,
      destination: room.name, target: target ? { x: target.x, y: target.y, label: local ? extra.marker || label : '前往' + room.name } : null,
      local, ...extra };
  };
  const home = label => at(boatRoom, boatRoom.boat || { x: 85, y: 600 }, label,
    a.inventory.length ? '在鲸艇旁按住 E 交付；满三格先回艇' : '按住 E 登艇，进入本章结算', { marker: a.inventory.length ? '回艇交付' : '登艇结算' });
  if (a.evacuationStarted) return home(a.inventory.length ? '撤离：返艇交付，再登艇' : '撤离：返回鲸艇登艇');
  if (chapter.number === 5) {
    if (current.id !== beaconRoom.id && !a.remoteReady) return at(beaconRoom, beaconRoom.beacon, '前往远端站，收集资料并集结', '先准备，确认后才开始六十秒倒计时');
    if (carried.length < 3 && !a.remoteReady) {
      const item = (state(beaconRoom).items || []).filter(item => missing.some(m => m.id === item.id)).sort((x,y) => near(x, world.player) - near(y, world.player))[0];
      if (item) return at(beaconRoom, item, `收集最终资料 ${carried.length}/3`, '三份都放入背包，再在信标装载', { marker: '最终资料' });
    }
    if (a.rendezvousCrew.length < 3) return at(beaconRoom, beaconRoom.beacon, `信标集结队友 ${a.rendezvousCrew.length}/3`, '按住 E 召集；队友会沿梯路赶来', { marker: '召集队友' });
    if (!a.remoteReady) return at(beaconRoom, beaconRoom.beacon, '在信标装载三份资料', '按住 E 装载；现在尚未开始倒计时', { marker: '装载资料' });
    return at(beaconRoom, beaconRoom.beacon, '准备好后，确认六十秒撤离', '检查返程路线，按住 E 确认；随后回艇交付并登艇', { marker: '确认撤离' });
  }
  if (a.inventory.length >= 3 || !missing.length && a.inventory.length) return home(`回艇交付 ${a.inventory.length} 份资料`);
  // Chapter four's broadcast is a choice, not the mandatory next step. Staying
  // public is faster but leaks records; the console prompt states both sides.
  const candidates = rooms.flatMap(room => (state(room).items || []).filter(item => missing.some(m => m.id === item.id)).map(item => ({ room, item })));
  candidates.sort((x,y) => Number(y.room.id === current.id) - Number(x.room.id === current.id) || near(x.item, world.player) - near(y.item, world.player));
  if (candidates.length) {
    const { room, item } = candidates[0];
    const node = state(room).nodes?.find(node => node.itemId === item.id && node.hp > 0);
    return at(room, item, `收集${chapter.number === 4 ? '任务档案' : '资料'} ${delivered + carried.length}/${required.size}`,
      node ? `同层冲刺 ${node.hp} 次打开节点，也可请 Grok 破障` : chapter.number <= 3 ? '靠近资料拾取；未打开的蓝色节点需要两次独立冲刺' : '靠近任务档案拾取', { marker: node ? `冲刺 × ${node.hp}` : '收集资料' });
  }
  const unfinished = view.objectives.find(goal => !goal.complete && goal.id !== 'required-delivery');
  if (unfinished?.id === 'return-beacon-ready') return at(beaconRoom, beaconRoom.beacon, '设置远端返航信标', '按住 E 点亮信标，然后返回鲸艇', { marker: '设置信标' });
  if (unfinished) {
    const groups = chapter.requiredTargetGroups?.flat() || [];
    for (const room of rooms) {
      const target = room.targets.find(target => groups.includes(target.id) && !a.completedTargetIds.includes(target.id));
      if (target) return at(room, target, unfinished.label, `按 ${ {Grok:1,Claude:2,GLM:3}[target.teammate] } 选择 ${target.teammate}，查看范围后按 Enter 执行`, { marker: target.label, teammate: target.teammate, targetId: target.id });
    }
  }
  return home(a.inventory.length ? `回艇交付 ${a.inventory.length} 份资料` : '任务完成，返回鲸艇登艇');
}

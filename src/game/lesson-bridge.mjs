/** Read-only adapter from actual world state/receipts to TutorialDirector evidence. */
const MARKERS = Object.freeze({
  move: { x: 190, y: 600, label: '沿地面走到这里' },
  climb: { x: 240, y: 490, label: '沿短梯爬上平台' },
  jump: { x: 380, y: 490, label: '跳过缺口，在对面落地' },
  'node-first': { x: 390, y: 490, label: '冲刺撞击蓝色节点' },
  'node-open': { x: 390, y: 490, label: '再次独立冲刺，打开节点' },
  'grok-obstacle': { x: 442, y: 490, label: '让 Grok 实际破开纸窗' },
  delivery: { x: 85, y: 600, label: '回鲸艇完成交付' },
  board: { x: 85, y: 600, label: '松开互动，再按住登艇' },
});
const viewOf = world => { try { return world?.core?.view?.() ?? null; } catch { return null; } };
const roomOf = world => world?.currentRoom?.id ?? world?.map?.id ?? null;
const validPlayer = player => player && Number.isFinite(player.x) && Number.isFinite(player.y);
const snapshotPlayer = player => ({ x: player.x, y: player.y, w: player.w ?? 28, grounded: player.grounded === true,
  climbing: player.climbing === true, vy: Number.isFinite(player.vy) ? player.vy : 0 });
const platformsOf = world => world?.platforms ?? world?.map?.platforms ?? [];
const supportedBy = (world, player) => player?.grounded ? platformsOf(world).find(platform => !platform.disabled
  && Math.abs(player.y - platform.y) <= 3 && player.x + (player.w ?? 28) / 2 > platform.x
  && player.x - (player.w ?? 28) / 2 < platform.x + platform.w) ?? null : null;
const inactive = reason => ({ ok: false, reason });

export class LessonBridge {
  constructor({ tutorial, world = null } = {}) {
    if (!tutorial || typeof tutorial.handleEvent !== 'function' || typeof tutorial.getState !== 'function') throw new TypeError('LessonBridge needs a TutorialDirector');
    this.tutorial = tutorial; this.world = world; this.sequence = 0;
    this.previous = null; this.motionRoom = null; this.attemptId = null; this.observedWorld = null;
    this.climb = null; this.jump = null; this.walkDistance = 0;
    this.deliveryIds = new Set(); this.deliveredIds = new Set(); this.boardedAttempt = null;
    this.#baseline(world, true);
  }

  get marker() {
    const current = this.tutorial.current?.(), world = this.world;
    if (!current) return null;
    if (this.tutorial.chapter === 'paper-window') {
      const continuation = this.#objectiveContinuation(viewOf(world));
      if (continuation) return continuation.marker ? { ...continuation.marker, guideStep: continuation.guide } : null;
      let marker = MARKERS[current.id]; if (!marker) return null;
      if (['node-first', 'node-open'].includes(current.id) && Array.isArray(world?.nodes)) {
        const node = current.id === 'node-open' ? world.nodes.find(entry => entry.id === this.tutorial.memory.nodeId && entry.hp > 0)
          : world.nodes.filter(entry => entry.hp >= 2).sort((a, b) => Math.abs(a.x - (world.player?.x ?? 0)) - Math.abs(b.x - (world.player?.x ?? 0)))[0];
        if (node) marker = { ...marker, x: node.x, y: node.y };
      }
      // Point to the local return exit instead of through an unloaded room.
      if (world?.currentRoom && world.currentRoom.index !== 1) {
        const exit = world.map?.exits?.find(entry => entry.to === 'paper-window:room-1');
        return exit ? { x: exit.x, y: exit.y, label: '从这里返回入港教学码头', guideStep: this.tutorial.guideView?.() } : null;
      }
      return { ...marker, guideStep: this.tutorial.guideView?.() };
    }
    const member = current.id.startsWith('claude-') ? 'Claude' : current.id === 'glm-scan' ? 'GLM' : null;
    const target = world?.map?.targets?.find(entry => entry.teammate === member);
    return target ? { x: target.x, y: target.y, label: current.text } : null;
  }
  getMarker() { return this.marker; }

  #objectiveContinuation(view) {
    const current = this.tutorial.current?.(), world = this.world;
    if (this.tutorial.chapter !== 'paper-window' || !['delivery', 'board'].includes(current?.id)
      || !view?.objectives?.length || view.objectives.every(goal => goal.complete)) return null;
    const attempt = view.attempt ?? {}, inventory = attempt.inventory ?? [], delivered = attempt.deliveredIds ?? [];
    const delivery = view.objectives.find(goal => goal.id === 'required-delivery');
    const requiredIds = (view.chapter?.requiredItems ?? []).map(item => item.id ?? item);
    const missing = requiredIds.filter(id => !inventory.includes(id) && !delivered.includes(id));
    const progress = delivery ? `已交 ${delivery.current}/${delivery.required}` : '资料尚未交齐';
    const make = (objectiveKey, text, control, marker, tools, route) => ({ marker,
      guide: { index: 8, total: 10, text, control, objectiveContinuation: true, objectiveKey,
        hints: [text, tools, route] } });
    const returnExit = world?.map?.exits?.find(exit => exit.to === 'paper-window:room-1');
    const returnMarker = world?.map?.boat ?? (world?.currentRoom?.index === 1 ? MARKERS.delivery : returnExit);
    if ((current.id === 'delivery' && inventory.length > 0) || inventory.length >= 3 || (!missing.length && inventory.length > 0)) {
      const full = inventory.length >= 3 && missing.length > 0;
      return make(`deliver:${inventory.join(',')}`, full ? `背包已满，先回鲸艇交付，再收集剩余资料（${progress}）。`
        : `带着背包里的资料回鲸艇交付（${progress}）。`, 'interact',
      returnMarker && { x: returnMarker.x, y: returnMarker.y, label: world?.map?.boat ? '回鲸艇交付，再继续任务' : '从这里返回鲸艇码头' },
      '回到鲸艇旁，按住互动直到交付进度完成；背包最多三格。',
      '路线示范：沿当前房间的梯子下到地面，经过返程出口回码头，再到鲸艇交付。');
    }
    if (delivery && !delivery.complete) {
      const localItem = (world?.items ?? []).filter(item => !item.collected && missing.includes(item.id))
        .sort((a, b) => Math.hypot(a.x - (world.player?.x ?? 0), a.y - (world.player?.y ?? 600))
          - Math.hypot(b.x - (world.player?.x ?? 0), b.y - (world.player?.y ?? 600)))[0];
      if (localItem) {
        const node = world.nodes?.find(node => node.itemId === localItem.id && node.hp > 0);
        const action = node ? `对蓝色节点独立冲刺 ${node.hp} 次，然后靠近拾取。` : '靠近亮起的必需资料，拾取后继续收集。';
        return make(`collect:${localItem.id}:${node?.hp ?? 0}`, `继续收集必需资料（${progress}）：${action}`, node ? 'dash' : 'right',
          { x: localItem.x, y: localItem.y, label: node ? '打开这个必需资料节点' : '拾取这份必需资料' },
          node ? '与蓝色节点保持同层，使用冲刺；每次冲刺后等待冷却恢复。' : '使用移动和梯子到达资料旁；装满三格就先返回鲸艇。',
          '路线示范：跟随标记到达该平台，打开节点并拾取资料；资料全部交付后才进入登艇步骤。');
      }
      const targetRoom = world?.rooms?.find(room => room.id !== roomOf(world) && room.items?.some(item => missing.includes(item.id)));
      const targetExit = world?.map?.exits?.find(exit => exit.to === targetRoom?.id)
        ?? world?.map?.exits?.find(exit => exit.to === 'paper-window:room-2') ?? returnExit;
      return make(`travel:${targetExit?.to ?? 'required-data'}`, `继续前往${targetRoom?.name ?? '资料机房'}收集剩余必需资料（${progress}）。`, 'right',
        targetExit && { x: targetExit.x, y: targetExit.y, label: `从这里前往${targetRoom?.name ?? '主场景继续收集'}` },
        '走到当前房间的主通道出口，按住互动换房；可选档案不代替必需资料。',
        '路线示范：沿梯子下到主通道，跟随出口标记进入另一个主场景，收集资料后回艇交付。');
    }
    const pending = view.objectives.filter(goal => !goal.complete);
    const target = world?.map?.targets?.find(target => target.id === 'paper-window');
    const marker = target ?? returnExit;
    return make(`objectives:${pending.map(goal => goal.id).join(',')}`, `登艇前还需完成：${pending.map(goal => goal.label).join('、')}。`, 'command',
      marker && { x: marker.x, y: marker.y, label: target ? '让 Grok 完成纸窗指令' : '返回码头完成剩余目标' },
      '选择 Grok 和纸窗目标，查看默认方案后确认执行，等待实际完成回执。',
      '路线示范：回到教学码头，让队友完成剩余有效指令；所有本章目标完成后再登艇。');
  }
  #syncObjectiveGuide(view = viewOf(this.world)) {
    this.#retireOutgrownLesson(view);
    this.tutorial.setObjectiveGuide?.(this.#objectiveContinuation(view)?.guide ?? null);
  }
  /** Free play can make a one-time exercise unavailable. Retire it without inventing completion evidence. */
  #retireOutgrownLesson(view) {
    const current = this.tutorial.current?.(), world = this.world;
    if (!current || !world) return;
    if (view?.phase === 'chapter-result') { this.tutorial.skip(); return; }
    const firstChapter = this.tutorial.chapter === 'paper-window';
    if (firstChapter && ['delivery', 'board'].includes(current.id)) return;
    const leftTrainingRoom = world.currentRoom && world.currentRoom.index !== 1;
    const earlyAction = firstChapter && (
      world.barriers?.some(barrier => barrier.id === 'paper-window' && barrier.broken)
      || (current.id !== 'grok-obstacle' && ((view?.attempt?.inventory?.length ?? 0) > 0 || (view?.attempt?.deliveredIds?.length ?? 0) > 0)));
    const unavailableNode = firstChapter && Array.isArray(world.nodes) && world.nodes.length > 0 && (
      current.id === 'node-first' && !world.nodes.some(node => node.hp >= 2)
      || current.id === 'node-open' && !world.nodes.some(node => node.id === this.tutorial.memory.nodeId && node.hp > 0));
    if (leftTrainingRoom || earlyAction || unavailableNode) this.tutorial.skip();
  }

  /** A route is a demonstration, shown only after two actual failures or an explicit request. */
  getRoute() {
    const state = this.tutorial.getState(), marker = this.marker, world = this.world;
    if (!state.canShowRoute || !marker || !validPlayer(world?.player)) return [];
    const current = this.tutorial.current();
    if (this.tutorial.chapter === 'paper-window' && (!world.currentRoom || world.currentRoom.index === 1)) {
      if (current.id === 'climb') return [{ x: 240, y: 600 }, { x: 240, y: 490 }];
      if (current.id === 'jump') return [{ x: 308, y: 490 }, { x: 343, y: 438 }, { x: 380, y: 490 }];
    }
    // Return examples follow real ladders down to the exit/boat floor. Merely
    // viewing this line never emits a completed movement or interaction event.
    const route = [], position = { x: world.player.x, y: world.player.y };
    if (marker.y > position.y + 6) {
      const ladders = world.map?.ladders ?? [];
      for (let count = 0; count < ladders.length && position.y < marker.y - 6; count++) {
        const ladder = ladders.filter(entry => Math.abs(entry.y - position.y) <= 6 && entry.h > 0 && entry.y + entry.h <= marker.y + 6)
          .sort((a, b) => Math.abs(a.x - position.x) - Math.abs(b.x - position.x))[0];
        if (!ladder) break;
        route.push({ x: ladder.x, y: ladder.y }, { x: ladder.x, y: ladder.y + ladder.h });
        position.x = ladder.x; position.y = ladder.y + ladder.h;
      }
    }
    route.push({ x: marker.x, y: marker.y });
    return route;
  }

  #baseline(world, resetDelivery = false) {
    const view = viewOf(world);
    this.previous = validPlayer(world?.player) ? snapshotPlayer(world.player) : null;
    this.motionRoom = roomOf(world); this.climb = null; this.jump = null; this.walkDistance = 0;
    this.observedWorld = world; this.attemptId = view?.attempt?.attemptId ?? null;
    if (resetDelivery) {
      this.deliveryIds = new Set(view?.attempt?.deliveryIds ?? []);
      this.deliveredIds = new Set(view?.attempt?.deliveredIds ?? []);
      this.boardedAttempt = null;
    }
    this.#syncObjectiveGuide(view);
  }
  #submit(type, payload, events = null) {
    const result = this.tutorial.handleEvent(type, payload);
    this.#syncObjectiveGuide();
    result.state = this.tutorial.getState();
    if (events && result.ok) events.push({ type, payload: { ...payload }, result });
    return result;
  }
  #eventId(type) { return `lesson:${this.attemptId ?? 'world'}:${type}:${++this.sequence}`; }
  #deliveries(view, events) {
    const attempt = view?.attempt; if (!attempt) return;
    const newDeliveries = (attempt.deliveryIds ?? []).filter(id => !this.deliveryIds.has(id));
    const newItems = (attempt.deliveredIds ?? []).filter(id => !this.deliveredIds.has(id));
    if (newDeliveries.length && newItems.length) this.#submit('delivery', {
      eventId: newDeliveries[0], deliveryIds: newDeliveries, itemIds: newItems, count: newItems.length, status: 'completed',
    }, events);
    this.deliveryIds = new Set(attempt.deliveryIds ?? []); this.deliveredIds = new Set(attempt.deliveredIds ?? []);
    if (view.phase === 'chapter-result' && view.pendingResult && this.boardedAttempt !== attempt.attemptId) {
      this.boardedAttempt = attempt.attemptId;
      this.#submit('board', { eventId: `lesson:${attempt.attemptId}:board`, complete: true }, events);
    }
  }

  /** Observe after world.update. dt is seconds; hint clocks remain owned by the caller. */
  observe(world = this.world, dt = 1 / 60) {
    if (!world) return { state: this.tutorial.getState(), marker: null, events: [], progress: false };
    this.world = world;
    const events = [], view = viewOf(world), attemptId = view?.attempt?.attemptId ?? null;
    if (this.observedWorld !== world || this.attemptId !== attemptId) {
      this.#baseline(world, true);
      return { state: this.tutorial.getState(), marker: this.marker, events, progress: false };
    }
    this.#deliveries(view, events);
    this.#syncObjectiveGuide(view);
    const player = world.player;
    if (!validPlayer(player) || !this.previous || roomOf(world) !== this.motionRoom) {
      this.#baseline(world, false);
      return { state: this.tutorial.getState(), marker: this.marker, events, progress: events.length > 0 };
    }
    const current = snapshotPlayer(player), previous = this.previous;
    if (!Number.isFinite(dt) || dt <= 0 || dt > 1) {
      // A stationary pause preserves an already witnessed climb/jump; unexplained movement cannot.
      if (current.x !== previous.x || current.y !== previous.y) this.#baseline(world, false);
      return { state: this.tutorial.getState(), marker: this.marker, events, progress: events.length > 0 };
    }
    const discontinuous = Math.abs(current.x - previous.x) > 1000 * dt + 18 || Math.abs(current.y - previous.y) > 1000 * dt + 20;
    if (discontinuous) {
      this.previous = current; this.climb = null; this.jump = null; this.walkDistance = 0;
      return { state: this.tutorial.getState(), marker: this.marker, events, progress: events.length > 0 };
    }
    if (view?.phase !== 'playing') return { state: this.tutorial.getState(), marker: this.marker, events, progress: events.length > 0 };
    const inDockLesson = this.tutorial.chapter === 'paper-window' && (!world.currentRoom || world.currentRoom.index === 1);
    if (inDockLesson) {
      const support = supportedBy(world, current), previousSupport = supportedBy(world, previous);
      if (current.grounded && previous.grounded && support && Math.abs(current.y - 600) <= 3 && Math.abs(previous.y - 600) <= 3) {
        this.walkDistance += Math.abs(current.x - previous.x);
        const reached = Math.abs(current.x - MARKERS.move.x) <= 18 || previous.x <= MARKERS.move.x && current.x >= MARKERS.move.x;
        if (reached && this.walkDistance >= 35) this.#submit('move', { eventId: this.#eventId('move'), reached: true }, events);
      }
      const ladder = (world.map?.ladders ?? []).find(entry => Math.abs(current.x - entry.x) <= 28
        && current.y >= entry.y - 4 && current.y <= entry.y + entry.h + 4 && Math.abs(entry.y - MARKERS.climb.y) <= 4 && Math.abs(entry.x - MARKERS.climb.x) <= 30);
      if (current.climbing && ladder) {
        if (!this.climb || this.climb.ladderId !== ladder.id) this.climb = { ladderId: ladder.id, top: ladder.y, x: ladder.x, ascent: 0 };
        if (previous.climbing || Math.abs(previous.x - ladder.x) <= 35) this.climb.ascent += Math.max(0, previous.y - current.y);
      }
      if (this.climb && current.grounded && support && Math.abs(current.y - this.climb.top) <= 4
        && Math.abs(current.x - this.climb.x) <= 40 && this.climb.ascent >= 20) {
        this.#submit('climb', { eventId: this.#eventId('climb'), reached: true, grounded: true, onPlatform: true, ladderId: this.climb.ladderId }, events);
        this.climb = null;
      }
      if (!this.jump && previous.grounded && previousSupport && !previous.climbing && !current.grounded && !current.climbing && current.vy < -20) {
        this.jump = { from: { ...previousSupport }, startX: previous.x, minY: current.y, airborneSamples: 1, minX: Math.min(previous.x, current.x), maxX: Math.max(previous.x, current.x) };
      } else if (this.jump && !current.grounded && !current.climbing) {
        this.jump.airborneSamples++; this.jump.minY = Math.min(this.jump.minY, current.y);
        this.jump.minX = Math.min(this.jump.minX, current.x); this.jump.maxX = Math.max(this.jump.maxX, current.x);
      }
      if (this.jump && current.grounded) {
        const from = this.jump.from, to = support;
        const rightGap = to && to.x - (from.x + from.w), leftGap = to && from.x - (to.x + to.w);
        // Crossing the gap is the lesson, not the exact takeoff pixel: jumping
        // from anywhere on the west pier and landing on the far side counts.
        const crossedRight = rightGap >= 20 && current.x >= to.x + 2;
        const crossedLeft = leftGap >= 20 && current.x <= to.x + to.w - 2;
        if (to && to.id !== from.id && Math.abs(to.y - from.y) <= 4 && Math.abs(to.y - MARKERS.jump.y) <= 4
          && this.jump.minY < from.y - 12 && this.jump.airborneSamples >= 2 && (crossedRight || crossedLeft)) {
          this.#submit('jump', { eventId: this.#eventId('jump'), grounded: true, crossedGap: true, fromPlatform: from.id, toPlatform: to.id }, events);
        }
        this.jump = null;
      }
      if (current.climbing) this.jump = null;
    }
    this.previous = current;
    return { state: this.tutorial.getState(), marker: this.marker, events, progress: events.length > 0 };
  }

  /** Forward only actual completion callbacks; card edits and key inputs are deliberately ignored. */
  handleEvent(type, payload = {}) {
    if (type && typeof type === 'object') { payload = { ...type, ...type.payload }; type = type.type; }
    if (!payload || typeof payload !== 'object' || payload.ok === false || payload.failed === true || payload.success === false || payload.preview === true) return inactive('not-a-successful-event');
    if (type === 'room-change' || type === 'pickup') {
      this.#syncObjectiveGuide();
      return { ok: true, state: this.tutorial.getState() };
    }
    if (['node-hit', 'node-first', 'node-open', 'node-opened', 'obstacle-broken'].includes(type)) return this.#submit(type, payload);
    if (type === 'command-receipt') {
      if (payload.status && !['completed', 'complete'].includes(payload.status)) return inactive('command-not-completed');
      const plan = payload.taskplan ?? payload.taskPlan ?? payload.plan ?? {};
      const entry = { ...plan, ...payload, eventId: payload.eventId ?? payload.id ?? payload.commandId,
        teammate: payload.teammate ?? plan.teammate, precise: payload.precise ?? plan.precise ?? false,
        affectedGuardIds: payload.affectedGuardIds ?? payload.affected?.guards,
        revealedIds: payload.revealedIds ?? payload.affected?.traps, status: 'completed' };
      if (entry.teammate === 'Claude') return this.#submit(entry.precise ? 'constraint-effective' : 'decoy-effective', entry);
      if (entry.teammate === 'GLM') return this.#submit('scan-complete', entry);
      if (entry.teammate === 'Grok') {
        const broken = (payload.affected?.barriers ?? []).some(id => this.world?.barriers?.some(barrier => barrier.id === id && barrier.broken));
        if (!broken && payload.broken !== true) return inactive('no-obstacle-completion');
        return this.#submit('obstacle-broken', { ...entry, broken: true });
      }
      return inactive('unknown-teammate');
    }
    if (['delivery', 'delivery-complete'].includes(type)) {
      if (payload.count > 0 || payload.itemIds?.length) return this.#submit('delivery', { ...payload, status: 'completed' });
      const events = []; this.#deliveries(viewOf(this.world), events);
      return events[0]?.result ?? inactive('no-new-delivery');
    }
    if (['board', 'board-complete', 'chapter-result'].includes(type)) {
      const view = viewOf(this.world);
      if (payload.complete !== true && payload.status !== 'completed' && !(view?.phase === 'chapter-result' && view.pendingResult)) return inactive('board-not-completed');
      return this.#submit('board', { ...payload, complete: true });
    }
    return inactive('irrelevant-event');
  }
}

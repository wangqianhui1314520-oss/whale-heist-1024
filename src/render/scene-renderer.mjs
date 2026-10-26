import { renderResolution } from '../render/resolution.mjs';
import { sampleCharacterMotion, drawCharacterMotionFX } from '../render/character-motion.mjs';
import { SCAN_WARNING_SECONDS } from '../game/world.mjs';

const TAU = Math.PI * 2;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const TEAM_COLORS = { Grok: '#ffb66e', Claude: '#ffd08a', GLM: '#b6a6ff' };
// Ambient cues also use scan/impact art before the corresponding teammate
// joins. Every chapter therefore preloads the shared scene palette in full.
export function sceneImageKeys(chapter = {}) {
  return [...new Set(['gameplay-backdrop','deepseek-actions','masonry-kit','mechanisms-kit','harbor-kit','props-kit','guard','investigator','chrome-kit','whale-emblem',
    'water-dash-atlas','axe-impact-atlas','paper-decoy-atlas','scan-grid-atlas',
    'deepseek-portrait','grok-portrait','claude-portrait','glm-portrait',
    ...(chapter.teammates || []).map(name=>name.toLowerCase()+'-actions')])];
}
// Source fragments are taken from unmodified, authored PNGs. They are never
// repainted as runtime shapes: the same library owns their preload and draw.
const BUBBLE = [583, 327, 23, 26];
const GRID = [180, 307, 300, 95];
const ALARM_GLOW = [247, 802, 38, 43];
const CHAPTER_VISUALS = Object.freeze({
  1: { accent: '#72e6ff', warm: '#f4d99b' },
  2: { accent: '#a6b9ff', warm: '#ffd08a' },
  3: { accent: '#b6a6ff', warm: '#9ee7e3' },
  4: { accent: '#d9a4ff', warm: '#ffb985' },
  5: { accent: '#8bdcff', warm: '#f0cc8d' },
});

/** Fixed-camera scene composed entirely from the authored PNG library.
 * Canvas paths are reserved for gameplay range masks and optional debug data.
 * CSS controls the responsive canvas size; world coordinates stay at 1280×720.
 */
export class GameRenderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    const doc = canvas.ownerDocument;
    this.layers = {
      background: doc?.getElementById('background-canvas') || canvas,
      structure: doc?.getElementById('structure-canvas') || canvas,
      actors: canvas,
      effects: doc?.getElementById('effects-canvas') || canvas,
    };
    this.contexts = Object.fromEntries(Object.entries(this.layers).map(([key, layer]) => [key, layer.getContext('2d', { alpha: key !== 'background' })]));
    this.labelRoot = doc?.getElementById('scene-labels');
    this.labelPool = []; this.labelCount = 0;
    this.assets = assets; this.width = 1280; this.height = 720; this.dpr = 1; this.quality = 'standard';
    this.resize();
    this._resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.resize()) : null;
    this._resizeObserver?.observe(canvas);
    globalThis.addEventListener?.('resize', () => this.resize());
  }

  resize(quality = this.quality) {
    this.quality = quality || this.quality || 'standard';
    const requested = Number(globalThis.devicePixelRatio) || 1;
    const mobile = Boolean(globalThis.matchMedia?.('(hover: none), (pointer: coarse)')?.matches);
    const cssWidth = this.canvas.getBoundingClientRect?.().width || this.width;
    const dpr = renderResolution({ dpr: requested, cssWidth, mobile, quality: this.quality });
    if (Math.abs(dpr - this.dpr) < 0.01 && this.canvas.width === Math.round(this.width * dpr)) return;
    this.dpr = dpr;
    for (const [name, layer] of Object.entries(this.layers)) {
      const scale = name === 'background' ? Math.min(1.5, dpr) : dpr;
      layer.width = Math.round(this.width * scale); layer.height = Math.round(this.height * scale);
      layer.style.aspectRatio = `${this.width} / ${this.height}`;
      layer.dataset.renderScale = String(scale);
      const ctx = this.contexts[name]; ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    }
  }

  #layer(name) { this.ctx = this.contexts[name]; return this.ctx; }
  #beginLayers() {
    for (const [name, layer] of Object.entries(this.layers)) {
      const ctx = this.contexts[name], scale = Number(layer.dataset.renderScale) || this.dpr;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    }
    this.labelCount = 0;
  }
  #endLabels() { for (let i = this.labelCount; i < this.labelPool.length; i++) this.labelPool[i].hidden = true; }
  #sprite(id, x, y, options = {}) {
    if (!this.assets.catalog.sprites[id]) return false;
    return this.assets.draw(this.ctx, id, Math.round(x), Math.round(y), options);
  }
  #fx(group, time, x, y, options = {}) {
    return this.assets.drawEffect(this.ctx, group, this.reduceMotion ? 0 : Math.max(0, time), Math.round(x), Math.round(y), { loop: true, untrimmed: false, ...options });
  }
  #bubble(x, y, size = 5, opacity = .4) {
    this.#sprite('scene-water-channel', x, y, { sourceRect: BUBBLE, width: size, height: size, anchor: [.5, .5], opacity });
  }
  #wake(x, y, width, height, opacity = .35) {
    this.#sprite('fx-water-dash-04', x, y, { width, height, stretch: true, untrimmed: false, anchor: [.5, .5], opacity });
  }

  /** Exact semantic geometry clips authored scan texture; it never paints a
   * synthetic cone, rectangle or circle. The bubble trail marks its boundary.
   */
  #range(bounds, { circle = false, opacity = .17, boundary = true, danger = false } = {}) {
    if (!bounds || !(bounds.w > 0 && bounds.h > 0)) return;
    const ctx = this.ctx, { x, y, w, h } = bounds;
    ctx.save(); ctx.beginPath();
    if (circle) ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU);
    else ctx.rect(x, y, w, h);
    ctx.clip();
    this.#sprite(danger ? 'scene-alarm-sensor' : 'fx-scan-grid-01', x, y, { sourceRect: danger ? ALARM_GLOW : GRID, width: w, height: h, stretch: true, anchor: [0, 0], opacity });
    ctx.restore();
    if (!boundary) return;
    if (circle) {
      const count = Math.max(12, Math.ceil(Math.PI * (w + h) / 38));
      for (let i = 0; i < count; i++) { const angle = i / count * TAU; this.#signal(x + w / 2 + Math.cos(angle) * w / 2, y + h / 2 + Math.sin(angle) * h / 2, 3.5, .62, danger); }
    } else this.#route([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y }], .6, 3.5, 19, danger);
  }

  #signal(x, y, size, opacity, danger = false) {
    if (danger) this.#sprite('scene-alarm-sensor', x, y, { sourceRect: ALARM_GLOW, width: size, height: size, anchor: [.5, .5], opacity });
    else this.#bubble(x, y, size, opacity);
  }

  /** Authored bubble samples follow the actual navigation route. */
  #route(points, opacity = .55, size = 4, spacing = 18, danger = false) {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      const steps = Math.max(1, Math.ceil(length / spacing));
      for (let n = 0; n < steps; n++) this.#signal(a.x + (b.x - a.x) * n / steps, a.y + (b.y - a.y) * n / steps, size, opacity, danger);
    }
  }

  render(world, coreView, { reduceMotion = false, reduceFlashes = false, debug = false, quality = this.quality } = {}) {
    this.reduceFlashes = reduceFlashes; this.reduceMotion = reduceMotion;
    if (quality !== this.quality) this.resize(quality);
    this.#beginLayers();
    const time = reduceMotion ? 0 : world?.time || 0;
    this.#layer('background');
    this.#sprite('background-gameplay-backdrop', 0, 0, { width: 1280, height: 720, stretch: true, anchor: [0, 0] });
    if (!world) { this.#endLabels(); return; }
    this.#ambientWater(time, false, coreView);
    this.#decorations(world);
    this.#backgroundEnvironment(world, coreView, time);
    this.#chapterLandmarks(world, coreView, time);
    this.#layer('structure');
    this.#platforms(world); this.#ladders(world); this.#mechanisms(world, time);
    this.#boatAndBeacons(world, coreView, time);
    if (world.expanded) this.#roomExits(world);
    this.#hazards(world, time); this.#collectibles(world, time);
    this.#targetHints(world, coreView?.attempt || {}, time); this.#commandRange(world);
    if (world.tutorialMarker) this.#tutorialMarker(world);
    this.#guards(world, time);
    this.#layer('actors');
    const actors = [...world.crew.map(actor => ({ ...actor, isPlayer: false })), { ...world.player, name: 'DeepSeek', isPlayer: true, carryCount: coreView?.attempt?.inventory?.length || 0 }];
    actors.sort((a, b) => a.y - b.y || Number(a.isPlayer) - Number(b.isPlayer));
    actors.forEach(actor => this.#actor(actor, world, time, reduceMotion));
    this.#layer('effects');
    this.#environmentOverlay(world, coreView, time);
    this.#foregroundAtmosphere(time);
    this.#effects(world); this.#scanWarning(world); this.#ambientWater(time, true, coreView);
    if (debug) this.#debug(world);
    this.#endLabels();
  }

  #visuals(coreView = {}) {
    const chapter = Number(coreView?.chapter?.number || 1);
    return { ...(CHAPTER_VISUALS[chapter] || CHAPTER_VISUALS[1]), emergency: chapter === 5 && coreView?.attempt?.evacuationStarted };
  }
  #decorations(world) {
    for (const decoration of world.map.decoration || []) this.#sprite(decoration.asset, decoration.x, decoration.y, { width: decoration.w, height: decoration.h, stretch: true, anchor: [0, 0], opacity: .94 });
  }
  #backgroundEnvironment(world, coreView, time) {
    const chapter = Number(coreView?.chapter?.number || 1), optional = Boolean(world.currentRoom?.optional);
    const low = this.quality === 'low', phase = low ? 0 : time;
    // Existing machined panels and server faces supply conduits, cables and
    // LEDs. No separately drawn grids, linework or fake server lamps remain.
    for (let i = 0; i < (low ? 2 : 3); i++) {
      const x = 125 + i * 455 + Math.sin(phase * .12 + i) * 4;
      this.#sprite(optional ? 'scene-server-rack' : 'scene-room-back-wall', x, 316, { width: optional ? 88 : 130, height: 168, opacity: optional ? .21 : .14 });
    }
    for (let i = 0; i < (low ? 5 : 11); i++) this.#bubble((i * 137 + 41) % 1250, 575 - ((phase * (4 + i % 4) + i * 53) % 470), 3 + i % 3, .18);
    if (chapter === 2) {
      for (let i = 0; i < (low ? 3 : 5); i++) this.#sprite('prop-resume-decoy', (i * 271 + phase * 9) % 1320 - 20, 145 + i % 3 * 63, { width: 29, height: 37, opacity: .32, rotation: (i % 2 ? -1 : 1) * .08 });
    } else if (chapter === 3) {
      this.#fx('scan-grid', phase * .45, 1020, 185, { width: 245, height: 100, opacity: .16, flipX: true });
    } else if (chapter === 4) {
      this.#sprite('prop-broadcast-console', 1090, 265, { width: 96, height: 138, opacity: .24 });
      this.#fx('scan-grid', phase * .35, 1030, 165, { width: 180, height: 55, opacity: .14, flipX: true });
    } else {
      this.#sprite('scene-mothership', 170 + Math.sin(phase * .15) * 12, 210, { width: 195, height: 90, opacity: .15 });
    }
  }

  #platforms(world) {
    for (const platform of [...world.platforms].sort((a, b) => a.y - b.y)) {
      if (platform.kind === 'lift') {
        this.#sprite('scene-ladder', platform.x + platform.w / 2, platform.minY, { width: 15, height: platform.maxY - platform.minY + 22, stretch: true, anchor: [.5, 0], opacity: .35 });
        this.#sprite('scene-lift-platform', platform.x, platform.y, { width: platform.w, height: 30, stretch: true, anchor: [0, 0] });
      } else if (platform.kind === 'thin') this.#sprite('scene-platform-thin', platform.x, platform.y, { width: platform.w, height: 28, stretch: true, anchor: [0, 0] });
      else if (platform.id === 'floor') {
        for (let x = platform.x; x < platform.x + platform.w; x += 256) this.#sprite('scene-platform-middle', x, platform.y, { width: Math.min(256, platform.x + platform.w - x) + 1, height: 83, stretch: true, anchor: [0, 0] });
      } else this.#sprite('scene-platform-middle', platform.x, platform.y, { width: platform.w, height: 68, stretch: true, anchor: [0, 0] });
      // Platform art already includes its collision lip. Event bridges add a
      // small authored water wake rather than another synthetic top edge.
      if (platform.eventBridge) this.#wake(platform.x + platform.w / 2, platform.y + 2, platform.w - 10, 8, .58);
    }
  }
  #ladders(world) {
    for (const ladder of world.map.ladders) this.#sprite('scene-ladder', ladder.x, ladder.y, { width: 27, height: ladder.h + 5, stretch: true, anchor: [.5, 0] });
  }
  #mechanisms(world, time) {
    this.#sprite('scene-mfa-door-fixed', 1220, 475, { width: 60, height: 125, stretch: true, anchor: [0, 0] });
    this.#groundLabel(1250, 435, 'MFA · 禁行', '#efb99f', 11, false, 'sealed-exit');
    for (const barrier of world.barriers) this.#sprite(barrier.broken ? 'scene-paper-barrier-broken' : 'scene-paper-barrier-intact', barrier.x, barrier.y, { width: barrier.w, height: barrier.h, stretch: true, anchor: [0, 0], opacity: barrier.broken ? .55 : 1 });
    for (const gate of world.gates) this.#sprite(gate.open ? 'scene-gate-open' : 'scene-gate-closed', gate.x - 3, gate.y, { width: gate.w + 6, height: gate.h, stretch: true, anchor: [0, 0] });
    for (const plate of world.plates) {
      this.#sprite('scene-pressure-plate', plate.x, plate.y, { width: plate.w, height: 12, stretch: true, anchor: [0, 0], opacity: plate.pressed ? 1 : .72 });
      if (plate.pressed) this.#wake(plate.x + plate.w / 2, plate.y + 2, plate.w - 8, 9, .58);
      const near = world.nearby?.type === 'plate' && Math.hypot(world.player.x - plate.x - plate.w / 2, world.player.y - plate.y) < 75;
      if (near) {
        this.#groundLabel(plate.x + plate.w / 2, plate.y - 35, `E · ${world.nearby.label || '压力板'}`, plate.pressed ? '#8ef4d9' : '#efc778', 10, true);
        const gate = world.gates.find(candidate => candidate.id === plate.gateId);
        if (gate) this.#route([{ x: plate.x + plate.w / 2, y: plate.y }, { x: gate.x + gate.w / 2, y: gate.y + gate.h / 2 }], .28, 3);
      }
    }
  }

  #chapterLandmarks(world, coreView, time) {
    const chapter = Number(coreView?.chapter?.number || 1), index = Number(world.currentRoom?.index || 1);
    const x = index === 1 ? 1025 : 1110;
    if (chapter === 1) {
      this.#sprite('scene-room-back-wall', index === 1 ? 430 : 880, 274, { width: 105, height: 125, opacity: .55 });
    } else if (chapter === 2) {
      this.#sprite('scene-paper-barrier-intact', 925, 278, { width: 94, height: 124, opacity: .4 });
      for (let i = 0; i < 3; i++) this.#sprite('prop-resume-decoy', 855 + i * 64 + Math.sin(time * .5 + i) * 5, 150 + i * 27, { width: 29, height: 36, opacity: .47, rotation: (i - 1) * .14 });
    } else if (chapter === 3) {
      this.#sprite('scene-server-rack', x, 300, { width: 105, height: 174, opacity: .54 });
      this.#fx('scan-grid', time * .45, x - 105, 207, { width: 240, height: 100, opacity: .3, flipX: true });
    } else if (chapter === 4) {
      this.#sprite('prop-broadcast-console', x, 286, { width: 105, height: 150, opacity: .56 });
      this.#sprite('prop-return-beacon', x + 30, 177, { width: 44, height: 68, opacity: .58 });
    } else {
      this.#sprite('prop-return-beacon', x, 300, { width: 100, height: 172, opacity: .6 });
      this.#wake(x, 305, 150, 28, .3);
    }
  }

  #boatAndBeacons(world, coreView, time) {
    const attempt = coreView?.attempt || {}, boat = world.map.boat;
    if (boat) {
      this.#sprite('scene-mothership', boat.x, boat.y, { width: 175, height: 110, stretch: true, anchor: [.5, 1] });
      if (world.nearby?.type === 'boat') { this.#groundLabel(boat.x + 5, boat.y - 115, `E · ${world.nearby.label || '母舰'}`, '#9cd8ee', 12, true); this.#wake(boat.x, boat.y - 3, 156, 24, .55); }
    }
    const broadcast = world.map.broadcast;
    if (broadcast) {
      this.#sprite('prop-broadcast-console', broadcast.x, broadcast.y, { width: 51, height: 72 });
      if (attempt.broadcastOn) this.#fx('scan-grid', time * .65, broadcast.x + 40, broadcast.y - 50, { width: 90, height: 36, opacity: .48 });
      if (world.nearby?.type === 'broadcast') this.#groundLabel(broadcast.x, broadcast.y - 82, `E · ${world.nearby.label}`, '#e8bd86', 11, true);
    }
    if ((coreView?.chapter?.number || 1) < 4 || !world.map.beacon) return;
    const beacon = world.map.beacon, ready = attempt.returnBeaconReady || attempt.remoteReady || attempt.evacuationStarted;
    this.#sprite('prop-return-beacon', beacon.x, beacon.y, { width: 49, height: 66, opacity: ready ? 1 : .7 });
    if (ready) this.#wake(beacon.x, beacon.y - 3, 78, 18, .5);
    if (coreView?.chapter?.number === 5 && (attempt.evacuationStage || attempt.evacuationStarted)) this.#route([{ x: beacon.x - 270, y: beacon.y + 4 }, { x: beacon.x, y: beacon.y + 4 }], .65, 5);
    if (world.nearby?.type === 'beacon') this.#groundLabel(beacon.x, beacon.y - 76, `E · ${world.nearby.label}`, ready ? '#a7efda' : '#b4e4f8', 11, true);
  }
  #roomExits(world) {
    const room = world.currentRoom;
    this.#groundLabel(640, 87, room.name, '#bee9f5', 11);
    for (const exit of room.exits) {
      const destination = world.rooms.find(r => r.id === exit.to), optional = destination?.optional;
      const sealed = optional && world.core.view().attempt.evacuationStarted;
      const unlocked = world.eventFlags?.has?.(exit.requiresEvent) || world.eventFlags?.includes?.(exit.requiresEvent);
      const locked = exit.requiresEvent && !unlocked;
      const closed = locked || sealed;
      // The atlas cells are almost square. Fit-to-box silently reduced the old
      // 45×85 exit to 45×45; give every room doorway an explicit, actor-sized
      // frame instead. Its feet stay on the interaction point's platform.
      this.ctx.save();
      this.ctx.shadowColor = closed ? '#e3a279' : optional ? '#f6cb79' : '#75e7f6';
      this.ctx.shadowBlur = 10;
      this.#sprite(closed ? 'scene-gate-closed' : 'scene-gate-open', exit.x, exit.y, {
        width: 92, height: 104, stretch: true, anchor: [.5, 1], opacity: 1,
      });
      this.ctx.restore();
      if (!closed) this.#wake(exit.x, exit.y + 2, 92, 14, .75);
      const direction = exit.x < 140 ? '← ' : exit.x > 1100 ? '→ ' : '';
      const name = String(exit.label || destination?.name || '通道').replace(/^支线\s*[·:：]\s*/, '');
      const text = locked ? '封闭 · 取得夹层档案开启'
        : sealed ? '支线已封存' : direction + (optional ? '支线 · ' : '') + name;
      this.#groundLabel(exit.x, exit.y - 123, text, closed ? '#f0bd9a' : optional ? '#ffe0a0' : '#b8f4ff', 12,
        false, closed ? 'sealed-exit' : optional ? 'optional-exit' : 'room-exit');
    }
  }
  #tutorialMarker(world) {
    const marker = world.tutorialMarker;
    this.#wake(marker.x, marker.y - 2, 52, 16, .68);
    if (world.tutorialRoute?.length) this.#route([{ x: world.player.x, y: world.player.y - 10 }, ...world.tutorialRoute.map(point => ({ x: point.x, y: point.y - 10 }))], .48, 4);
    this.#groundLabel(marker.x, marker.y - 95, marker.label || '下一步', '#b6f5e2', 11, true);
  }

  #collectibles(world, time) {
    for (const item of world.items) {
      if (item.collected) continue;
      const node = world.nodes?.find(n => n.itemId === item.id && n.hp > 0);
      if (node) {
        this.#sprite('prop-data-node', node.x, node.y, { width: 44, height: 52, opacity: node.hp === 1 ? .72 : 1 });
        if (node.hp === 1) this.#sprite('fx-axe-impact-04', node.x + 4, node.y - 30, { width: 35, height: 41, untrimmed: false, opacity: .52 });
        if (Math.hypot(node.x - world.player.x, node.y - world.player.y) < 125) this.#groundLabel(node.x, node.y - 64, node.hp === 2 ? '冲刺 × 2' : '冲刺 × 1', '#94ddef', 9);
        continue;
      }
      const bob = Math.sin(time * 2.6 + item.x * .013) * 3;
      const paper = item.kind === 'task-item' || item.kind === 'archive';
      this.#wake(item.x, item.y - 5, 38, 10, .2);
      this.#sprite(paper ? 'prop-resume-decoy' : 'prop-data-cube', item.x, item.y - 12 + bob, { width: 35, height: 36 });
      if (item.optional) this.#sprite('prop-qualifier-token', item.x + 17, item.y - 41 + bob, { width: 11, height: 13 });
    }
    for (const supply of world.supplies) {
      if (supply.collected) continue;
      const bob = Math.sin(time * 2.3 + supply.x * .02) * 2.5;
      this.#sprite('prop-qualifier-token', supply.x, supply.y - 12 + bob, { width: 28, height: 32 });
      if (Math.hypot(supply.x - world.player.x, supply.y - world.player.y) < 95) this.#groundLabel(supply.x, supply.y - 50 + bob, '限定词', '#a9d6e9', 9);
    }
  }
  #hazards(world, time) {
    for (const alarm of world.alarms) {
      this.#sprite('scene-alarm-sensor', alarm.x, alarm.y, { width: 23, height: 29 });
      const direction = alarm.direction === 'left' ? -1 : 1;
      this.#fx('scan-grid', time + alarm.x * .01, alarm.x + direction * 43, alarm.y - 12, { width: 86, height: 61, stretch: true, flipX: direction < 0, opacity: this.reduceFlashes ? .16 : .13 + (Math.sin(time * 4) + 1) * .025 });
    }
    for (const trap of world.traps) {
      const revealed = trap.revealedUntil > world.time, near = Math.hypot(trap.x + trap.w / 2 - world.player.x, trap.y - world.player.y) < 155;
      if (!revealed && !near) continue;
      this.#sprite('scene-hidden-trap', trap.x, trap.y - 4, { width: trap.w, height: 22, stretch: true, anchor: [0, 0], opacity: trap.active === false ? .22 : revealed ? 1 : .4 });
      if (revealed) this.#range({ x: trap.x - 3, y: trap.y - 6, w: trap.w + 6, h: 22 }, { opacity: .09, danger: trap.active !== false });
      if (revealed && near) this.#groundLabel(trap.x + trap.w / 2, trap.y - 13, world.expanded ? (trap.active ? '通电 · 绕行' : '断电 · 可过') : '陷阱', '#a7ddf0', 9);
    }
  }

  #targetHints(world, attempt, time) {
    for (const target of world.map.targets) {
      if ((attempt.completedTargetIds || []).includes(target.id) && world.selected !== target.teammate) continue;
      const selected = world.selected === target.teammate, current = world.commandPreview?.targetId === target.id;
      if (!selected && Math.hypot(target.x - world.player.x, target.y - world.player.y) > 175) continue;
      this.#sprite(`portrait-${target.teammate.toLowerCase()}`, target.x, target.y - 54, { width: selected ? 27 : 20, height: selected ? 27 : 20, anchor: [.5, .5], opacity: selected ? .96 : .65 });
      if (selected || current) this.#wake(target.x, target.y - 12, current ? 86 : 66, current ? 18 : 13, .55);
      if (selected) this.#groundLabel(target.x, target.y - 82, target.label, TEAM_COLORS[target.teammate] || '#b5e6fa', 11, current);
    }
  }
  #commandRange(world) {
    const preview = world.commandPreview;
    if (!preview) return;
    const actor = world.crew.find(candidate => candidate.name === preview.teammate), target = world.map.targets.find(candidate => candidate.id === preview.targetId);
    if (!actor || !target) return;
    const ctx = this.ctx, direction = target.x >= actor.x ? 1 : -1;
    ctx.save(); ctx.beginPath(); ctx.rect(0, world.expanded ? 95 : 65, 1280, world.expanded ? 510 : 535); ctx.clip();
    const route = world.expanded && preview.geometry ? [{ x: actor.x, y: actor.y - 20 }, ...(preview.route || []).map(point => ({ x: point.x, y: point.y - 20 }))] : [{ x: actor.x, y: actor.y - 36 }, { x: target.x, y: target.y - 30 }];
    this.#route(route, .58, 4);
    if (world.expanded && preview.geometry) {
      const geometry = preview.geometry, bounds = geometry.bounds;
      if (bounds) this.#range(bounds, { circle: Boolean(bounds.circle), opacity: .11 });
      for (const excluded of geometry.exclusions || []) {
        this.#range({ x: excluded.x - excluded.r, y: excluded.y - 20 - excluded.r, w: excluded.r * 2, h: excluded.r * 2 }, { circle: true, opacity: .08, danger: true });
        this.#sprite('scene-alarm-sensor', excluded.x, excluded.y - 20, { width: 13, height: 16, anchor: [.5, .5], opacity: .82 });
      }
      for (const id of [...(geometry.guardIds || []), ...(geometry.trapIds || []), ...(geometry.alarmIds || []), ...(geometry.barrierIds || []), ...(geometry.nodeIds || [])]) {
        const entry = [...world.guards, ...world.traps, ...world.alarms, ...world.barriers, ...world.nodes].find(e => e.id === id);
        if (entry) this.#wake(entry.x + (entry.w ? entry.w / 2 : 0), entry.y - (entry.h ? -entry.h / 2 : 24), 26, 13, .8);
      }
    } else if (preview.teammate === 'Grok') {
      const surface = world.nearestSurface(target), start = target.x - direction * 65;
      const end = preview.precise ? target.x + direction * 35 : clamp(target.x + direction * 290, surface.x + 20, surface.x + surface.w - 20);
      this.#range({ x: Math.min(start, end) - 15, y: target.y - 58, w: Math.abs(end - start) + 30, h: 58 });
    } else if (preview.teammate === 'Claude') {
      const guard = [...world.guards].filter(guard => Math.hypot(guard.x - target.x, guard.y - target.y) < 450).sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y))[0];
      const centre = preview.precise && guard ? guard : target, radius = preview.precise ? 48 : 450;
      this.#range({ x: centre.x - radius, y: centre.y - 22 - radius, w: radius * 2, h: radius * 2 }, { circle: true, opacity: .1 });
    } else if (preview.precise) this.#range({ x: target.x - (direction < 0 ? 210 : 0), y: target.y - 95, w: 210, h: 120 });
    else this.#range({ x: target.x - 280, y: target.y - 305, w: 560, h: 560 }, { circle: true, opacity: .1 });
    const destinations=new Set();
    for (const lure of preview.geometry?.lures || preview.lures || []) {
      const guard=world.guards.find(g=>g.id===lure.guardId);
      if (guard) this.#route([{x:guard.x,y:guard.y-28},{x:lure.x,y:lure.y-28}],.65,4);
      const key=`${lure.x}:${lure.y}`;if(destinations.has(key))continue;destinations.add(key);
      this.#sprite('prop-resume-decoy',lure.x,lure.y-30,{width:29,height:34});
      this.#groundLabel(lure.x,lure.y-135,'诱饵落点 · 停留 6 秒','#ffd08a',11,true);
    }
    ctx.restore();
    if (preview.geometry?.alarmIds?.length) this.#groundLabel(target.x, target.y - 110, `警戒器 × ${preview.geometry.alarmIds.length}`, '#edb29a', 10);
  }

  #guards(world, time) {
    const destinations=new Set();
    for (const guard of world.guards) {
      const bob = Math.sin(time * 3 + guard.x * .015) * 2, lured = guard.luredUntil > world.time;
      const direction = guard.direction === 'right' ? 1 : -1;
      if (!lured) {
        if (world.expanded) {
          this.#range(world.guardVision(guard), { opacity: .09 + (guard.suspicion || 0) * .05, danger: true });
          if ((guard.suspicion || 0) > 0) this.#sprite('scene-alarm-sensor', guard.x, guard.y - 86, { width: 17, height: 21 });
        } else this.#fx('scan-grid', time, guard.x + direction * 53, guard.y - 39 + bob, { width: 100, height: 46, stretch: true, flipX: direction < 0, opacity: .07 });
      }
      this.#sprite('enemy-guard', guard.x, guard.y - 9 + bob, { width: 58, height: 60, flipX: guard.direction === 'right' });
      if (lured) this.#sprite('prop-resume-decoy', guard.x, guard.y - 78 + bob, { width: 16, height: 18 });
      if (lured && guard.lure) {
        const key=`${guard.lure.x}:${guard.lure.y}`;
        if (!destinations.has(key)) {
          destinations.add(key);
          this.#sprite('prop-resume-decoy',guard.lure.x,guard.lure.y-28,{width:26,height:31});
          const arrived=Math.abs(guard.x-guard.lure.x)<2;
          this.#groundLabel(guard.lure.x,guard.lure.y-108,arrived?`分心 ${Math.max(0,guard.luredUntil-world.time).toFixed(1)}s · 可通行`:'前往诱饵 · 可通行','#ffd08a',11,true);
        }
      }
    }
  }
  #actor(actor, world, time, reduceMotion) {
    const ctx = this.ctx, motion = sampleCharacterMotion(actor, world, { time, reduceMotion });
    if (this.reduceFlashes) { motion.flash = 0; motion.opacity = 1; }
    const x = Math.round(actor.x) + motion.xOffset, y = Math.round(actor.y) + motion.yOffset;
    const direction = actor.direction || 'right';
    for (const trail of motion.trail) this.assets.drawActor(ctx, actor.name, motion.pose, direction, x + trail.xOffset, y + trail.yOffset, {
      opacity: trail.opacity, rotation: motion.rotation, scaleX: motion.scaleX, scaleY: motion.scaleY,
    });
    this.assets.drawActor(ctx, actor.name, motion.pose, direction, x, y, {
      opacity: motion.opacity, rotation: motion.rotation, scaleX: motion.scaleX, scaleY: motion.scaleY,
    });
    drawCharacterMotionFX(ctx, actor, world, motion, this.assets);
    if (!actor.isPlayer && world.selected === actor.name) this.#wake(actor.x, actor.y - 2, 48, 14, .7);
  }
  #effects(world) {
    for (const effect of world.effects) this.assets.drawEffect(this.ctx, effect.group, this.reduceMotion ? 0 : world.time - effect.started, Math.round(effect.x), Math.round(effect.y), { width: effect.group === 'water-dash' ? 185 : effect.group === 'scan-grid' ? 220 : 150, height: effect.group === 'water-dash' ? 100 : effect.group === 'scan-grid' ? 160 : 130, anchor: [.5, .5], flipX: effect.direction === 'left', opacity: .92 });
  }
  #scanWarning(world) {
    for (const pending of world.alarmWarnings || []) this.#groundLabel(pending.x, pending.y - 65, `${Math.max(0, pending.remaining).toFixed(1)}s`, '#f1ab95', 10, true);
    const warning = world.scanWarning;
    if (!warning) return;
    const geometry=world.scanGeometry(warning),status=world.scanStatus(warning);
    for(const region of geometry.danger)this.#range(region,{opacity:.16+clamp(1-warning.remaining/SCAN_WARNING_SECONDS,0,1)*.06,danger:true});
    for(const region of geometry.cover)this.#range(region,{opacity:.16});
    const instruction=`调查扫描 ${Math.max(0,warning.remaining).toFixed(1)}s · ${status==='exposed'?'危险：立即离开红区':status==='covered'?'安全：平台已遮挡':'安全：已离开红区'}\n红区固定 · 向两侧离开，或全身藏入平台下的蓝区`;
    this.#groundLabel(640,145,instruction,status==='exposed'?'#ffbdab':'#a9efda',14,true,'scan-instruction');
    for(const region of geometry.cover.filter(region=>region.w>=65&&region.h>=65))this.#groundLabel(region.x+region.w/2,Math.min(570,region.y+35),'平台遮挡区','#a9efda',10);
    this.#sprite('enemy-investigator', warning.x + warning.w / 2, warning.y + 92, { width: 54, height: 61, opacity: .9 });
  }

  #ambientWater(time, foreground, coreView) {
    const ctx = this.ctx, low = this.quality === 'low';
    const speed = coreView?.attempt?.evacuationStarted ? 1.65 : 1;
    const shift = this.reduceMotion || low ? 0 : (time * 7 * speed) % 256;
    ctx.save(); ctx.beginPath(); ctx.rect(0, foreground ? 620 : 610, 1280, foreground ? 100 : 110); ctx.clip();
    for (let x = -256 + shift; x < 1280; x += 256) this.#sprite('scene-water-channel', x, foreground ? 620 : 610, { width: 258, height: 112, stretch: true, anchor: [0, 0], opacity: foreground ? .57 : .34 });
    ctx.restore();
  }
  #foregroundAtmosphere(time) {
    if (this.reduceMotion || this.quality === 'low') return;
    for (let i = 0; i < 7; i++) this.#bubble((i * 151 + time * (5 + i % 3) * 3) % 1280, 120 + (i * 79 + time * (8 + i % 4)) % 470, i % 2 ? 6 : 4, .2);
  }
  #environmentOverlay(world, coreView, time) {
    const attempt = coreView?.attempt || {}, chapter = coreView?.chapter?.number || 1;
    for (const trap of world.traps || []) if (trap.revealedUntil > world.time) this.#wake(trap.x + trap.w / 2, trap.y - 3, trap.w + 12, 14, .42);
    if (chapter === 4 && attempt.broadcastOn) this.#sprite('prop-broadcast-console', 1170, 117, { width: 29, height: 41, opacity: .9 });
    if (chapter === 5 && attempt.evacuationStarted) {
      // The alarm's own painted red beacon replaces the former full-screen
      // red/blue drawn frame. Its restrained beat respects flash settings.
      const alpha = this.reduceMotion || this.reduceFlashes ? .82 : .7 + (Math.sin(time * 5) + 1) * .08;
      this.#sprite('scene-alarm-sensor', 1230, 121, { width: 27, height: 34, opacity: alpha });
      this.#sprite('prop-return-beacon', 34, 120, { width: 25, height: 39, opacity: .88 });
      this.#groundLabel(1140, 128, `${Math.max(0, Number(attempt.evacuationRemainingMs || 0) / 1000).toFixed(1)}s`, '#ffb2be', 12, true);
    }
  }

  #groundLabel(x, y, text, color = '#b4d7e8', size = 10, active = false, variant = '') {
    if (this.labelRoot) {
      const index = this.labelCount++;
      let label = this.labelPool[index];
      if (!label) { label = this.canvas.ownerDocument.createElement('span'); label.className = 'scene-label'; this.labelRoot.append(label); this.labelPool.push(label); }
      label.hidden = false;
      if (label.textContent !== text) label.textContent = text;
      label.classList.toggle('is-active', active);
      label.classList.toggle('optional-exit', variant === 'optional-exit');
      const doorway = ['room-exit', 'optional-exit', 'sealed-exit'].includes(variant);
      label.classList.toggle('room-exit', doorway);
      label.classList.toggle('floor-exit', doorway && y > 400);
      label.classList.toggle('sealed-exit', variant === 'sealed-exit');
      label.classList.toggle('scan-instruction', variant === 'scan-instruction');
      const edge = doorway && (x < 140 ? 'left' : x > 1100 ? 'right' : '');
      label.style.left = `${(edge === 'left' ? 18 : edge === 'right' ? 1262 : clamp(Math.round(x), 65, 1215)) / 12.8}%`; label.style.top = `${Math.round(y) / 7.2}%`;
      label.style.transform = `translate(${edge === 'left' ? '0' : edge === 'right' ? '-100%' : '-50%'}, -50%)`;
      label.style.color = color; label.style.fontSize = `max(${variant==='scan-instruction'?11:doorway?10:9}px, ${size / 12.8}cqw)`;
      return;
    }
    const ctx = this.ctx;
    ctx.save(); ctx.font = `${active ? 'bold ' : ''}${size}px "Microsoft YaHei",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const width = ctx.measureText(text).width + 22, cx = clamp(x, width / 2 + 4, 1276 - width / 2);
    this.#sprite('ui-resource-shell', cx, y, { width, height: 24, stretch: true, opacity: active ? 1 : .86 });
    ctx.fillStyle = color; ctx.fillText(text, cx, y + .5); ctx.restore();
  }
  #debug(world) {
    const ctx = this.ctx; ctx.save(); ctx.lineWidth = 1; ctx.strokeStyle = '#79ffa788';
    for (const platform of world.platforms) ctx.strokeRect(platform.x, platform.y, platform.w, platform.h);
    ctx.strokeStyle = '#ff8d8d88'; for (const solid of world.solidBodies()) ctx.strokeRect(solid.x, solid.y, solid.w, solid.h);
    const player = world.player; ctx.strokeStyle = '#ffed7b'; ctx.strokeRect(player.x - player.w / 2, player.y - player.h, player.w, player.h); ctx.restore();
  }
}

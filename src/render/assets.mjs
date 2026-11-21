/** Sprite-atlas adapter. All coordinates refer to the unmodified native PNGs. */
export class AssetLibrary {
  constructor(catalog, baseURL) {
    this.catalog = catalog;
    this.baseURL = new URL(baseURL, globalThis.document?.baseURI ?? globalThis.location?.href ?? 'file:///');
    this.images = new Map();
  }

  static async load(catalogURL = new URL('assets/runtime-catalog.json', globalThis.document?.baseURI ?? globalThis.location?.href ?? 'file:///')) {
    const resolvedURL = new URL(catalogURL, globalThis.document?.baseURI ?? globalThis.location?.href ?? 'file:///');
    const response = await fetch(resolvedURL);
    if (!response.ok) throw new Error(`Asset catalog: HTTP ${response.status}`);
    const library = new AssetLibrary(await response.json(), resolvedURL);
    await library.preload();
    return library;
  }

  async preload(keys = Object.keys(this.catalog.images), onProgress = () => {}) {
    const needed = [...new Set(keys)].filter(key => !this.images.has(key));
    let completed = 0;
    await Promise.all(needed.map(async key => {
      const entry = this.catalog.images[key];
      if (!entry) throw new Error(`Unknown image: ${key}`);
      const image = new Image();
      // The self-contained build embeds assets as data URIs; prefer those so a
      // copied HTML file has no dependency on a sibling assets/ folder.
      image.src = globalThis.__ASSET_DATA__?.[`assets/${String(entry.file).replace(/^\.?\//, '')}`]
        ?? new URL(entry.file, this.baseURL).href;
      await image.decode();
      this.images.set(key, image);
      onProgress(++completed / needed.length);
    }));
    return this;
  }

  /** x/y denote the sprite anchor. fit keeps aspect ratio; stretch is opt-in. */
  draw(ctx, id, x, y, options = {}) {
    const sprite = this.catalog.sprites[id];
    if (!sprite) throw new Error(`Unknown sprite: ${id}`);
    const image = this.images.get(sprite.image);
    if (!image) throw new Error(`Image not loaded: ${sprite.image}`);
    const untrimmed = options.untrimmed ?? sprite.category === 'fx_frame';
    // Authored atlas fragments can be reused for water, bubbles and range
    // textures without repainting equivalent geometry at runtime.
    const [sx, sy, sw, sh] = options.sourceRect ?? (untrimmed ? sprite.source_rect : sprite.content_rect);
    const width = options.width ?? sprite.logical_size[0];
    const height = options.height ?? sprite.logical_size[1];
    const scale = options.nativeScale ?? Math.min(width / sw, height / sh);
    const dw = options.stretch ? width : sw * scale;
    const dh = options.stretch ? height : sh * scale;
    const [ax, ay] = options.anchor ?? sprite.anchor;
    ctx.save();
    ctx.translate(x, y);
    if (options.flipX) ctx.scale(-1, 1);
    // Keep the atlas pixel art crisp while still allowing the renderer to add
    // small pose changes (breathing, footfall and skill recoil) without
    // duplicating every intermediate frame in the source atlases.
    if (options.rotation) ctx.rotate(options.rotation);
    if (options.scaleX != null || options.scaleY != null) {
      ctx.scale(options.scaleX ?? 1, options.scaleY ?? 1);
    }
    ctx.globalAlpha *= options.opacity ?? 1;
    ctx.drawImage(image, sx, sy, sw, sh, -dw * ax, -dh * ay, dw, dh);
    ctx.restore();
    return { width: dw, height: dh };
  }

  drawActor(ctx, character, state, direction, x, feetY, options) {
    const id = `character-${character.toLowerCase()}-${direction}-${state}`;
    const sprite = this.catalog.sprites[id];
    const actorOptions = options?.width != null || options?.height != null
      ? options
      : { nativeScale: sprite?.native_scale, ...options };
    return this.draw(ctx, id, x, feetY, actorOptions);
  }

  drawEffect(ctx, group, elapsedSeconds, x, y, options) {
    const animation = this.catalog.animations[group];
    if (!animation) throw new Error(`Unknown effect: ${group}`);
    if (!Number.isFinite(elapsedSeconds)) throw new Error('Effect time must be finite');
    if (elapsedSeconds < 0) return false;
    const index = Math.floor(elapsedSeconds * animation.fps);
    if (index >= animation.frames.length && !options?.loop) return false;
    this.draw(ctx, animation.frames[index % animation.frames.length], x, y, options);
    return true;
  }
}

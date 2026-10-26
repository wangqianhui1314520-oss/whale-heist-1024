/** Backing pixels per 1280×720 logical pixel; viewport zoom never changes physics. */
export function renderResolution({ dpr = 1, cssWidth = 1280, mobile = false, quality = 'standard' } = {}) {
  const screenScale = Math.max(0.1, Number(cssWidth) / 1280 || 1);
  const density = Math.max(1, Number(dpr) || 1);
  // Backing pixels per logical pixel that cover the physical pixel grid 1:1.
  const needed = screenScale * density;
  if (mobile) {
    // Smaller viewports stay within a predictable GPU/memory budget, but the
    // backing store must never sit below the physical grid: the old
    // round(target*4)/4 step dropped 844x390@3x (needed 1.625, 6.4997 -> 1.5)
    // and upscaled the frame. Standard supersamples 25% for AA headroom; low
    // keeps exactly 1:1 with a smaller floor.
    const target = Math.min(2, Math.max(quality === 'low' ? needed : needed * 1.25, quality === 'low' ? 1 : 1.5));
    return Math.round(target * 8) / 8;
  }
  const target = Math.max(2, Math.min(3, needed));
  return quality === 'low' ? 1.5 : quality === 'high' ? Math.min(3, Math.max(2.5, target)) : Math.round(target * 4) / 4;
}

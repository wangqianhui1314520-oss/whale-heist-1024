/** Backing pixels per 1280×720 logical pixel; viewport zoom never changes physics. */
export function renderResolution({ dpr = 1, cssWidth = 1280, mobile = false, quality = 'standard' } = {}) {
  const screenScale = Math.max(0.1, Number(cssWidth) / 1280 || 1);
  const density = Math.max(1, Number(dpr) || 1);
  if (mobile) {
    // Smaller viewports stay within a predictable GPU/memory budget.
    const target = Math.max(1.5, Math.min(2, screenScale * density));
    return quality === 'low' ? 1.5 : quality === 'high' ? 2 : Math.round(target * 4) / 4;
  }
  const target = Math.max(2, Math.min(3, screenScale * density));
  return quality === 'low' ? 1.5 : quality === 'high' ? Math.min(3, Math.max(2.5, target)) : Math.round(target * 4) / 4;
}

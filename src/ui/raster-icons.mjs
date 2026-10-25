// Source rectangles measured from the unmodified generated PNG. The sheet is
// deliberately not assumed to have mathematically identical cells.
export const OPERATION_ICON_SHEET = Object.freeze({ file:'assets/ui/operation-icons-v1.png', width:1285, height:1224 });
export const OPERATION_ICON_RECTS = Object.freeze({
  left:[39,39,259,235], right:[369,39,258,235], up:[693,22,235,254], down:[1007,22,238,255],
  jump:[10,296,284,294], dash:[308,315,362,266], interact:[694,295,257,298], pause:[1020,322,210,233],
  map:[18,610,317,262], settings:[376,597,252,275], book:[673,595,259,289], play:[1030,615,212,246],
  retry:[45,897,251,272], heart:[348,915,286,258], clock:[686,876,256,306], close:[1005,919,241,240],
});
const aliases = { archive:'book', home:'map', guide:'book', objective:'map', checkpoint:'retry', explore:'map', time:'clock' };
// Crop the painted badge itself; the original sheet has tall transparent cells.
const badgeRects = { token:[0,130,362,440], scan:[362,140,362,440], qualifier:[724,180,362,380], cube:[1086,170,362,400], broadcast:[1448,155,362,410] };
const esc = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function rasterIconStyle(name) {
  const id = aliases[name] || name, rect = OPERATION_ICON_RECTS[id];
  if (rect) {
    const [x,y,w,h] = rect, {width:iw,height:ih,file} = OPERATION_ICON_SHEET;
    return `background-image:url('${file}');background-size:${iw/w*100}% ${ih/h*100}%;background-position:${x/(iw-w)*100}% ${y/(ih-h)*100}%;border-radius:0;`;
  }
  if(id==='axe') return "background-image:url('assets/portraits/grok-portrait.png');background-size:contain;background-position:center;border-radius:0;";
  const [x,y,w,h] = badgeRects[id] || badgeRects.token;
  return `background-image:url('assets/ui/hud-icon-badges.png');background-size:${2172/w*100}% ${724/h*100}%;background-position:${x/(2172-w)*100}% ${y/(724-h)*100}%;border-radius:0;`;
}
export function rasterIconHTML(name, className='', label='') {
  const id = String(name || 'map').replace(/[^a-z0-9_-]/gi,'');
  return `<span class="ui-icon ui-icon--${id}${className ? ` ${className}` : ''}" data-icon="${id}" style="${rasterIconStyle(id)}"${label ? ` role="img" aria-label="${esc(label)}"` : ' aria-hidden="true"'}></span>`;
}
export function applyRasterIcon(element, name) {
  const previous = element.dataset.icon;
  if(previous) element.classList.remove(`ui-icon--${previous}`);
  element.classList.add(`ui-icon--${name}`); element.dataset.icon=name;
  element.setAttribute('style',rasterIconStyle(name));
}

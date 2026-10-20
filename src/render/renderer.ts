// Software renderer: port of r_main.c, r_bsp.c, r_segs.c, r_plane.c, r_draw.c, r_things.c, r_sky.c.
// Pixel output is identical to vanilla at 320x200; hires doubles the internal resolution.
import { FRACBITS, FRACUNIT, FixedMul, FixedDiv, MAXINT, MININT, MAXSHORT } from '../core/fixed';
import {
  finesine, finecosine, finetangent, tantoangle, SlopeDiv, ANG90, ANG180, ANG270, ANGLETOFINESHIFT, FINEANGLES, DBITS,
} from '../core/tables';
import {
  BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT, NF_SUBSECTOR, ML_DONTPEGBOTTOM, ML_DONTPEGTOP, ML_MAPPED, MF_SHADOW,
  MF_TRANSLATION, MF_TRANSSHIFT, FF_FULLBRIGHT, FF_FRAMEMASK, Power, GameMode,
  type Node, type Seg, type Sector, type Side, type Line, type Subsector, type Mobj, type Player, type PspDef,
} from '../doom/defs';
import { g } from '../doom/state';
import { lv } from '../play/p_setup';
import { wad } from '../wad/wad';
import {
  R_InitData, R_GetColumn, columnofs as getcolumnofs, colormaps, textureheight, texturetranslation, flattranslation,
  firstflat, firstspritelump, lastspritelump, spritewidth, spriteoffset, spritetopoffset, patchColOfs,
} from './r_data';
import { screens, SCREENWIDTH, SCREENHEIGHT, ORIGWIDTH, hires, V_DrawPatch, onVideoResize } from './v_video';
import { sprnames } from '../doom/info';

// ---------------------------------------------------------------- constants
const FIELDOFVIEW = 2048;
export const LIGHTLEVELS = 16;
const LIGHTSEGSHIFT = 4;
const MAXLIGHTSCALE = 48;
const LIGHTSCALESHIFT = 12;
const MAXLIGHTZ = 128;
const LIGHTZSHIFT = 20;
export const NUMCOLORMAPS = 32;
const DISTMAP = 2;
const MAXSEGS = 32;
const MAXDRAWSEGS = 256;
const MAXVISSPRITES = 128;
const MINZ = FRACUNIT * 4;
const BASEYCENTER = 100;
const ANGLETOSKYSHIFT = 22;
const HEIGHTBITS = 12;
const HEIGHTUNIT = 1 << HEIGHTBITS;
const SIL_NONE = 0, SIL_BOTTOM = 1, SIL_TOP = 2, SIL_BOTH = 3;
const FUZZTABLE = 50;

// ---------------------------------------------------------------- view state
export let viewx = 0;
export let viewy = 0;
export let viewz = 0;
export let viewangle = 0;
let viewcos = 0;
let viewsin = 0;
let viewplayer: Player;
export let detailshift = 0;
let clipangle = 0;
let extralight = 0;
let fixedcolormap = -1; // offset into colormaps, -1 = none
export let framecount = 0;
let validcount = 0;

export let centerx = 0;
export let centery = 0;
let centerxfrac = 0;
let centeryfrac = 0;
let projection = 0;

export let viewwidth = 0;
export let scaledviewwidth = 0;
export let viewheight = 0;
export let viewwindowx = 0;
export let viewwindowy = 0;

const viewangletox = new Int32Array(FINEANGLES / 2);
let xtoviewangle = new Uint32Array(SCREENWIDTH + 1);
let ylookup = new Int32Array(SCREENHEIGHT);
let columnofs = new Int32Array(SCREENWIDTH);

// Light tables hold offsets into `colormaps`.
const scalelight: Int32Array[] = Array.from({ length: LIGHTLEVELS }, () => new Int32Array(MAXLIGHTSCALE));
const scalelightfixed = new Int32Array(MAXLIGHTSCALE);
const zlight: Int32Array[] = Array.from({ length: LIGHTLEVELS }, () => new Int32Array(MAXLIGHTZ));
let walllights: Int32Array = scalelight[0];
let spritelights: Int32Array = scalelight[0];
let planezlight: Int32Array = zlight[0];

let pspritescale = 0;
let pspriteiscale = 0;

// ---------------------------------------------------------------- column / span drawing state (r_draw.c)
let dc_colormap = 0;
let dc_x = 0;
let dc_yl = 0;
let dc_yh = 0;
let dc_iscale = 0;
let dc_texturemid = 0;
let dc_source: Uint8Array = new Uint8Array(1);
let dc_srcofs = 0;
let dc_translation = 0; // offset into translationtables
const translationtables = new Uint8Array(256 * 3);

let ds_y = 0;
let ds_x1 = 0;
let ds_x2 = 0;
let ds_colormap = 0;
let ds_xfrac = 0;
let ds_yfrac = 0;
let ds_xstep = 0;
let ds_ystep = 0;
let ds_source: Uint8Array = new Uint8Array(4096);

let fuzzoffset = new Int32Array(FUZZTABLE);
let fuzzpos = 0;

type ColFunc = () => void;
let colfunc: ColFunc;
let basecolfunc: ColFunc;
let fuzzcolfunc: ColFunc;
let spanfunc: ColFunc;

function R_DrawColumn(): void {
  let count = dc_yh - dc_yl;
  if (count < 0) return;
  const dest = screens[0];
  const cmap = colormaps;
  const src = dc_source;
  const sofs = dc_srcofs;
  const cm = dc_colormap;
  const sw = SCREENWIDTH;
  let d = ylookup[dc_yl] + columnofs[dc_x];
  const fracstep = dc_iscale;
  let frac = (dc_texturemid + (dc_yl - centery) * fracstep) | 0;
  do {
    dest[d] = cmap[cm + (src[sofs + ((frac >> FRACBITS) & 127)] | 0)];
    d += sw;
    frac = (frac + fracstep) | 0;
  } while (count--);
}

function R_DrawColumnLow(): void {
  let count = dc_yh - dc_yl;
  if (count < 0) return;
  const dest = screens[0];
  const sw = SCREENWIDTH;
  const x = dc_x << 1;
  let d = ylookup[dc_yl] + columnofs[x];
  let d2 = ylookup[dc_yl] + columnofs[x + 1];
  const fracstep = dc_iscale;
  let frac = (dc_texturemid + (dc_yl - centery) * fracstep) | 0;
  do {
    dest[d2] = dest[d] = colormaps[dc_colormap + (dc_source[dc_srcofs + ((frac >> FRACBITS) & 127)] | 0)];
    d += sw;
    d2 += sw;
    frac = (frac + fracstep) | 0;
  } while (count--);
}

function R_DrawFuzzColumn(): void {
  if (!dc_yl) dc_yl = 1;
  if (dc_yh === viewheight - 1) dc_yh = viewheight - 2;
  let count = dc_yh - dc_yl;
  if (count < 0) return;
  const dest = screens[0];
  const sw = SCREENWIDTH;
  const x = detailshift ? dc_x << 1 : dc_x;
  let d = ylookup[dc_yl] + columnofs[x];
  do {
    const c = colormaps[6 * 256 + (dest[d + fuzzoffset[fuzzpos]] | 0)];
    dest[d] = c;
    if (detailshift) dest[d + 1] = c;
    if (++fuzzpos === FUZZTABLE) fuzzpos = 0;
    d += sw;
  } while (count--);
}

function R_DrawTranslatedColumn(): void {
  let count = dc_yh - dc_yl;
  if (count < 0) return;
  const dest = screens[0];
  const sw = SCREENWIDTH;
  const x = detailshift ? dc_x << 1 : dc_x;
  let d = ylookup[dc_yl] + columnofs[x];
  const fracstep = dc_iscale;
  let frac = (dc_texturemid + (dc_yl - centery) * fracstep) | 0;
  do {
    const c = colormaps[dc_colormap + translationtables[dc_translation + (dc_source[dc_srcofs + (frac >> FRACBITS)] | 0)]];
    dest[d] = c;
    if (detailshift) dest[d + 1] = c;
    d += sw;
    frac = (frac + fracstep) | 0;
  } while (count--);
}

function R_DrawSpan(): void {
  let xfrac = ds_xfrac;
  let yfrac = ds_yfrac;
  const dest = screens[0];
  let d = ylookup[ds_y] + columnofs[ds_x1];
  let count = ds_x2 - ds_x1;
  const src = ds_source;
  const cm = ds_colormap;
  do {
    const spot = ((yfrac >> (16 - 6)) & (63 * 64)) + ((xfrac >> 16) & 63);
    dest[d++] = colormaps[cm + src[spot]];
    xfrac = (xfrac + ds_xstep) | 0;
    yfrac = (yfrac + ds_ystep) | 0;
  } while (count--);
}

function R_DrawSpanLow(): void {
  let xfrac = ds_xfrac;
  let yfrac = ds_yfrac;
  const dest = screens[0];
  // Count in low-detail columns, then double (Chocolate Doom's fix of linuxdoom's overdraw).
  let count = ds_x2 - ds_x1;
  let d = ylookup[ds_y] + columnofs[ds_x1 << 1];
  do {
    const spot = ((yfrac >> (16 - 6)) & (63 * 64)) + ((xfrac >> 16) & 63);
    const c = colormaps[ds_colormap + ds_source[spot]];
    dest[d++] = c;
    dest[d++] = c;
    xfrac = (xfrac + ds_xstep) | 0;
    yfrac = (yfrac + ds_ystep) | 0;
  } while (count--);
}

function R_InitTranslationTables(): void {
  for (let i = 0; i < 256; i++) {
    if (i >= 0x70 && i <= 0x7f) {
      translationtables[i] = 0x60 + (i & 0xf);
      translationtables[i + 256] = 0x40 + (i & 0xf);
      translationtables[i + 512] = 0x20 + (i & 0xf);
    } else {
      translationtables[i] = translationtables[i + 256] = translationtables[i + 512] = i;
    }
  }
}

function R_InitBuffer(width: number, height: number): void {
  viewwindowx = (SCREENWIDTH - width) >> 1;
  columnofs = new Int32Array(SCREENWIDTH);
  for (let i = 0; i < width; i++) columnofs[i] = viewwindowx + i;
  viewwindowy = width === SCREENWIDTH ? 0 : (SCREENHEIGHT - SBARHEIGHT() - height) >> 1;
  ylookup = new Int32Array(SCREENHEIGHT);
  for (let i = 0; i < height; i++) ylookup[i] = (i + viewwindowy) * SCREENWIDTH;
}

export function SBARHEIGHT(): number {
  return 32 << hires;
}

/** Fill screens[1] with the border backdrop for reduced view sizes. */
export function R_FillBackScreen(): void {
  if (scaledviewwidth === SCREENWIDTH) return;
  const flat = wad.bytesName(g.gamemode === GameMode.commercial ? 'GRNROCK' : 'FLOOR7_2');
  const dest = screens[1];
  const s = 1 << hires;
  for (let y = 0; y < SCREENHEIGHT - SBARHEIGHT(); y++) {
    for (let x = 0; x < SCREENWIDTH; x++) dest[y * SCREENWIDTH + x] = flat[((((y / s) | 0) & 63) << 6) + (((x / s) | 0) & 63)];
  }
  // Border patches are positioned in original 320x200 space.
  const vx = viewwindowx >> hires, vy = viewwindowy >> hires;
  const vw = scaledviewwidth >> hires, vh = viewheight >> hires;
  const p = (n: string) => wad.cacheLumpName(n);
  for (let x = 0; x < vw; x += 8) V_DrawPatch(vx + x, vy - 8, 1, p('BRDR_T'));
  for (let x = 0; x < vw; x += 8) V_DrawPatch(vx + x, vy + vh, 1, p('BRDR_B'));
  for (let y = 0; y < vh; y += 8) V_DrawPatch(vx - 8, vy + y, 1, p('BRDR_L'));
  for (let y = 0; y < vh; y += 8) V_DrawPatch(vx + vw, vy + y, 1, p('BRDR_R'));
  V_DrawPatch(vx - 8, vy - 8, 1, p('BRDR_TL'));
  V_DrawPatch(vx + vw, vy - 8, 1, p('BRDR_TR'));
  V_DrawPatch(vx - 8, vy + vh, 1, p('BRDR_BL'));
  V_DrawPatch(vx + vw, vy + vh, 1, p('BRDR_BR'));
}

/** Copy the border area from screens[1] to screens[0]. */
export function R_DrawViewBorder(): void {
  if (scaledviewwidth === SCREENWIDTH) return;
  const h = SCREENHEIGHT - SBARHEIGHT();
  const src = screens[1];
  const dst = screens[0];
  for (let y = 0; y < h; y++) {
    const row = y * SCREENWIDTH;
    if (y < viewwindowy || y >= viewwindowy + viewheight) {
      dst.set(src.subarray(row, row + SCREENWIDTH), row);
    } else {
      dst.set(src.subarray(row, row + viewwindowx), row);
      dst.set(src.subarray(row + viewwindowx + scaledviewwidth, row + SCREENWIDTH), row + viewwindowx + scaledviewwidth);
    }
  }
}

// ---------------------------------------------------------------- geometry helpers (r_main.c)
export function R_PointOnSide(x: number, y: number, node: Node): number {
  if (!node.dx) {
    if (x <= node.x) return node.dy > 0 ? 1 : 0;
    return node.dy < 0 ? 1 : 0;
  }
  if (!node.dy) {
    if (y <= node.y) return node.dx < 0 ? 1 : 0;
    return node.dx > 0 ? 1 : 0;
  }
  const dx = (x - node.x) | 0;
  const dy = (y - node.y) | 0;
  if ((node.dy ^ node.dx ^ dx ^ dy) & 0x80000000) {
    if ((node.dy ^ dx) & 0x80000000) return 1;
    return 0;
  }
  const left = FixedMul(node.dy >> FRACBITS, dx);
  const right = FixedMul(dy, node.dx >> FRACBITS);
  if (right < left) return 0;
  return 1;
}

export function R_PointOnSegSide(x: number, y: number, line: Seg): number {
  const lx = line.v1.x;
  const ly = line.v1.y;
  const ldx = (line.v2.x - lx) | 0;
  const ldy = (line.v2.y - ly) | 0;
  if (!ldx) {
    if (x <= lx) return ldy > 0 ? 1 : 0;
    return ldy < 0 ? 1 : 0;
  }
  if (!ldy) {
    if (y <= ly) return ldx < 0 ? 1 : 0;
    return ldx > 0 ? 1 : 0;
  }
  const dx = (x - lx) | 0;
  const dy = (y - ly) | 0;
  if ((ldy ^ ldx ^ dx ^ dy) & 0x80000000) {
    if ((ldy ^ dx) & 0x80000000) return 1;
    return 0;
  }
  const left = FixedMul(ldy >> FRACBITS, dx);
  const right = FixedMul(dy, ldx >> FRACBITS);
  if (right < left) return 0;
  return 1;
}

export function R_PointToAngle(x: number, y: number): number {
  x = (x - viewx) | 0;
  y = (y - viewy) | 0;
  if (!x && !y) return 0;
  if (x >= 0) {
    if (y >= 0) {
      if (x > y) return tantoangle[SlopeDiv(y, x)];
      return (ANG90 - 1 - tantoangle[SlopeDiv(x, y)]) >>> 0;
    }
    y = -y | 0;
    if (x > y) return -tantoangle[SlopeDiv(y, x)] >>> 0;
    return (ANG270 + tantoangle[SlopeDiv(x, y)]) >>> 0;
  }
  x = -x | 0;
  if (y >= 0) {
    if (x > y) return (ANG180 - 1 - tantoangle[SlopeDiv(y, x)]) >>> 0;
    return (ANG90 + tantoangle[SlopeDiv(x, y)]) >>> 0;
  }
  y = -y | 0;
  if (x > y) return (ANG180 + tantoangle[SlopeDiv(y, x)]) >>> 0;
  return (ANG270 - 1 - tantoangle[SlopeDiv(x, y)]) >>> 0;
}

/** Note: like vanilla this overwrites viewx/viewy (harmless; R_SetupFrame resets them). */
export function R_PointToAngle2(x1: number, y1: number, x2: number, y2: number): number {
  viewx = x1;
  viewy = y1;
  return R_PointToAngle(x2, y2);
}

export function R_PointToDist(x: number, y: number): number {
  let dx = Math.abs((x - viewx) | 0) | 0;
  let dy = Math.abs((y - viewy) | 0) | 0;
  if (dy > dx) {
    const t = dx;
    dx = dy;
    dy = t;
  }
  const angle = ((tantoangle[FixedDiv(dy, dx) >> DBITS] + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
  return FixedDiv(dx, finesine[angle]);
}

let rw_normalangle = 0;
let rw_distance = 0;

function R_ScaleFromGlobalAngle(visangle: number): number {
  const anglea = (ANG90 + (visangle - viewangle)) >>> 0;
  const angleb = (ANG90 + (visangle - rw_normalangle)) >>> 0;
  const sinea = finesine[anglea >>> ANGLETOFINESHIFT];
  const sineb = finesine[angleb >>> ANGLETOFINESHIFT];
  const num = FixedMul(projection, sineb) << detailshift;
  const den = FixedMul(rw_distance, sinea);
  let scale: number;
  if (den > num >> 16) {
    scale = FixedDiv(num, den);
    if (scale > 64 * FRACUNIT) scale = 64 * FRACUNIT;
    else if (scale < 256) scale = 256;
  } else scale = 64 * FRACUNIT;
  return scale;
}

function R_InitTextureMapping(): void {
  const focallength = FixedDiv(centerxfrac, finetangent[FINEANGLES / 4 + FIELDOFVIEW / 2]);
  for (let i = 0; i < FINEANGLES / 2; i++) {
    let t: number;
    if (finetangent[i] > FRACUNIT * 2) t = -1;
    else if (finetangent[i] < -FRACUNIT * 2) t = viewwidth + 1;
    else {
      t = FixedMul(finetangent[i], focallength);
      t = ((centerxfrac - t + FRACUNIT - 1) | 0) >> FRACBITS;
      if (t < -1) t = -1;
      else if (t > viewwidth + 1) t = viewwidth + 1;
    }
    viewangletox[i] = t;
  }
  xtoviewangle = new Uint32Array(viewwidth + 1);
  for (let x = 0; x <= viewwidth; x++) {
    let i = 0;
    while (viewangletox[i] > x) i++;
    xtoviewangle[x] = ((i << ANGLETOFINESHIFT) - ANG90) >>> 0;
  }
  for (let i = 0; i < FINEANGLES / 2; i++) {
    if (viewangletox[i] === -1) viewangletox[i] = 0;
    else if (viewangletox[i] === viewwidth + 1) viewangletox[i] = viewwidth;
  }
  clipangle = xtoviewangle[0];
}

function R_InitLightTables(): void {
  for (let i = 0; i < LIGHTLEVELS; i++) {
    const startmap = (((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS) | 0;
    for (let j = 0; j < MAXLIGHTZ; j++) {
      let scale = FixedDiv((ORIGWIDTH / 2) * FRACUNIT, (j + 1) << LIGHTZSHIFT);
      scale >>= LIGHTSCALESHIFT;
      let level = startmap - ((scale / DISTMAP) | 0);
      if (level < 0) level = 0;
      if (level >= NUMCOLORMAPS) level = NUMCOLORMAPS - 1;
      zlight[i][j] = level * 256;
    }
  }
}

export let setsizeneeded = false;
let setblocks = 10;
let setdetail = 0;

export function R_SetViewSize(blocks: number, detail: number): void {
  setsizeneeded = true;
  setblocks = blocks;
  setdetail = detail;
}

let screenheightarray = new Int16Array(SCREENWIDTH);
let negonearray = new Int16Array(SCREENWIDTH);
let yslope = new Int32Array(SCREENHEIGHT);
let distscale = new Int32Array(SCREENWIDTH);

export function R_ExecuteSetViewSize(): void {
  setsizeneeded = false;
  if (setblocks === 11) {
    scaledviewwidth = SCREENWIDTH;
    viewheight = SCREENHEIGHT;
  } else {
    scaledviewwidth = (setblocks * 32) << hires;
    viewheight = (((setblocks * 168 / 10) | 0) & ~7) << hires;
  }
  detailshift = setdetail;
  viewwidth = scaledviewwidth >> detailshift;
  centery = (viewheight / 2) | 0;
  centerx = (viewwidth / 2) | 0;
  centerxfrac = centerx << FRACBITS;
  centeryfrac = centery << FRACBITS;
  projection = centerxfrac;

  if (!detailshift) {
    colfunc = basecolfunc = R_DrawColumn;
    spanfunc = R_DrawSpan;
  } else {
    colfunc = basecolfunc = R_DrawColumnLow;
    spanfunc = R_DrawSpanLow;
  }
  fuzzcolfunc = R_DrawFuzzColumn;

  R_InitBuffer(scaledviewwidth, viewheight);
  R_InitTextureMapping();

  pspritescale = ((FRACUNIT * viewwidth) / ORIGWIDTH) | 0;
  pspriteiscale = ((FRACUNIT * ORIGWIDTH) / viewwidth) | 0;

  screenheightarray = new Int16Array(SCREENWIDTH).fill(viewheight);
  negonearray = new Int16Array(SCREENWIDTH).fill(-1);
  yslope = new Int32Array(SCREENHEIGHT);
  for (let i = 0; i < viewheight; i++) {
    let dy = (((i - ((viewheight / 2) | 0)) << FRACBITS) + FRACUNIT / 2) | 0;
    dy = Math.abs(dy);
    yslope[i] = FixedDiv((((viewwidth << detailshift) / 2) | 0) * FRACUNIT, dy);
  }
  distscale = new Int32Array(SCREENWIDTH);
  for (let i = 0; i < viewwidth; i++) {
    const cosadj = Math.abs(finecosine[xtoviewangle[i] >>> ANGLETOFINESHIFT]);
    distscale[i] = FixedDiv(FRACUNIT, cosadj);
  }
  for (let i = 0; i < LIGHTLEVELS; i++) {
    const startmap = (((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS) | 0;
    for (let j = 0; j < MAXLIGHTSCALE; j++) {
      let level = startmap - (((((j * SCREENWIDTH) / (viewwidth << detailshift)) | 0) / DISTMAP) | 0);
      if (level < 0) level = 0;
      if (level >= NUMCOLORMAPS) level = NUMCOLORMAPS - 1;
      scalelight[i][j] = level * 256;
    }
  }
  allocFrameBuffers();
}

export function R_Init(): void {
  R_InitData();
  R_InitLightTables();
  R_InitTranslationTables();
  framecount = 0;
}

export function R_PointInSubsector(x: number, y: number): Subsector {
  if (!lv.nodes.length) return lv.subsectors[0];
  let nodenum = lv.nodes.length - 1;
  while (!(nodenum & NF_SUBSECTOR)) {
    const node = lv.nodes[nodenum];
    nodenum = node.children[R_PointOnSide(x, y, node)];
  }
  return lv.subsectors[nodenum & ~NF_SUBSECTOR];
}

function R_SetupFrame(player: Player): void {
  viewplayer = player;
  viewx = player.mo!.x;
  viewy = player.mo!.y;
  viewangle = (player.mo!.angle + g.viewangleoffset) >>> 0;
  extralight = player.extralight;
  viewz = player.viewz;
  viewsin = finesine[viewangle >>> ANGLETOFINESHIFT];
  viewcos = finecosine[viewangle >>> ANGLETOFINESHIFT];
  if (player.fixedcolormap) {
    fixedcolormap = player.fixedcolormap * 256;
    walllights = scalelightfixed;
    scalelightfixed.fill(fixedcolormap);
  } else fixedcolormap = -1;
  framecount++;
  validcount = ++g.validcount;
}

export function R_RenderPlayerView(player: Player): void {
  R_SetupFrame(player);
  R_ClearClipSegs();
  R_ClearDrawSegs();
  R_ClearPlanes();
  R_ClearSprites();
  R_RenderBSPNode(lv.nodes.length - 1);
  R_DrawPlanes();
  R_DrawMasked();
}

// ---------------------------------------------------------------- planes (r_plane.c)
class Visplane {
  height = 0;
  picnum = 0;
  lightlevel = 0;
  minx = 0;
  maxx = 0;
  /** Indexed by x+1 so that top[minx-1] / top[maxx+1] are valid padding cells. 0xffff = unused. */
  top: Uint16Array;
  bottom: Uint16Array;
  constructor(w: number) {
    this.top = new Uint16Array(w + 2);
    this.bottom = new Uint16Array(w + 2);
  }
}
const VP_EMPTY = 0xffff;

let visplanes: Visplane[] = [];
let lastvisplane = 0;
let floorplane: Visplane | null = null;
let ceilingplane: Visplane | null = null;

let openings = new Int16Array(SCREENWIDTH * 64 * 4);
let lastopening = 0;
let floorclip = new Int16Array(SCREENWIDTH);
let ceilingclip = new Int16Array(SCREENWIDTH);
let spanstart = new Int32Array(SCREENHEIGHT);
let planeheight = 0;
let basexscale = 0;
let baseyscale = 0;
let cachedheight = new Int32Array(SCREENHEIGHT);
let cacheddistance = new Int32Array(SCREENHEIGHT);
let cachedxstep = new Int32Array(SCREENHEIGHT);
let cachedystep = new Int32Array(SCREENHEIGHT);

function allocFrameBuffers(): void {
  visplanes = [];
  openings = new Int16Array(SCREENWIDTH * 64 * 4);
  floorclip = new Int16Array(SCREENWIDTH);
  ceilingclip = new Int16Array(SCREENWIDTH);
  spanstart = new Int32Array(SCREENHEIGHT);
  cachedheight = new Int32Array(SCREENHEIGHT);
  cacheddistance = new Int32Array(SCREENHEIGHT);
  cachedxstep = new Int32Array(SCREENHEIGHT);
  cachedystep = new Int32Array(SCREENHEIGHT);
  clipbot = new Int16Array(SCREENWIDTH);
  cliptop = new Int16Array(SCREENWIDTH);
  for (let i = 0; i < FUZZTABLE; i++) fuzzoffset[i] = FUZZSIGNS[i] * SCREENWIDTH;
}

const FUZZSIGNS = [
  1, -1, 1, -1, 1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1, 1, -1, -1, -1, -1, 1, -1, -1, 1, 1, 1, 1, -1,
  1, -1, 1, 1, -1, -1, 1, 1, -1, -1, -1, -1, 1, 1, 1, 1, -1, 1, 1, -1, 1,
];

function R_MapPlane(y: number, x1: number, x2: number): void {
  let distance: number;
  if (planeheight !== cachedheight[y]) {
    cachedheight[y] = planeheight;
    distance = cacheddistance[y] = FixedMul(planeheight, yslope[y]);
    ds_xstep = cachedxstep[y] = FixedMul(distance, basexscale);
    ds_ystep = cachedystep[y] = FixedMul(distance, baseyscale);
  } else {
    distance = cacheddistance[y];
    ds_xstep = cachedxstep[y];
    ds_ystep = cachedystep[y];
  }
  const length = FixedMul(distance, distscale[x1]);
  const angle = ((viewangle + xtoviewangle[x1]) >>> 0) >>> ANGLETOFINESHIFT;
  ds_xfrac = (viewx + FixedMul(finecosine[angle], length)) | 0;
  ds_yfrac = (-viewy - FixedMul(finesine[angle], length)) | 0;
  if (fixedcolormap >= 0) ds_colormap = fixedcolormap;
  else {
    let index = distance >>> LIGHTZSHIFT;
    if (index >= MAXLIGHTZ) index = MAXLIGHTZ - 1;
    ds_colormap = planezlight[index];
  }
  ds_y = y;
  ds_x1 = x1;
  ds_x2 = x2;
  spanfunc();
}

function R_ClearPlanes(): void {
  for (let i = 0; i < viewwidth; i++) {
    floorclip[i] = viewheight;
    ceilingclip[i] = -1;
  }
  lastvisplane = 0;
  lastopening = 0;
  cachedheight.fill(0);
  const angle = ((viewangle - ANG90) >>> 0) >>> ANGLETOFINESHIFT;
  basexscale = FixedDiv(finecosine[angle], centerxfrac);
  baseyscale = -FixedDiv(finesine[angle], centerxfrac) | 0;
}

function newVisplane(): Visplane {
  if (lastvisplane === visplanes.length) visplanes.push(new Visplane(SCREENWIDTH));
  return visplanes[lastvisplane++];
}

function R_FindPlane(height: number, picnum: number, lightlevel: number): Visplane {
  if (picnum === g.skyflatnum) {
    height = 0;
    lightlevel = 0;
  }
  for (let i = 0; i < lastvisplane; i++) {
    const check = visplanes[i];
    if (height === check.height && picnum === check.picnum && lightlevel === check.lightlevel) return check;
  }
  const check = newVisplane();
  check.height = height;
  check.picnum = picnum;
  check.lightlevel = lightlevel;
  check.minx = SCREENWIDTH;
  check.maxx = -1;
  check.top.fill(VP_EMPTY);
  return check;
}

function R_CheckPlane(pl: Visplane, start: number, stop: number): Visplane {
  let intrl: number, intrh: number, unionl: number, unionh: number;
  if (start < pl.minx) {
    intrl = pl.minx;
    unionl = start;
  } else {
    unionl = pl.minx;
    intrl = start;
  }
  if (stop > pl.maxx) {
    intrh = pl.maxx;
    unionh = stop;
  } else {
    unionh = pl.maxx;
    intrh = stop;
  }
  let x: number;
  for (x = intrl; x <= intrh; x++) if (pl.top[x + 1] !== VP_EMPTY) break;
  if (x > intrh) {
    pl.minx = unionl;
    pl.maxx = unionh;
    return pl;
  }
  const npl = newVisplane();
  npl.height = pl.height;
  npl.picnum = pl.picnum;
  npl.lightlevel = pl.lightlevel;
  npl.minx = start;
  npl.maxx = stop;
  npl.top.fill(VP_EMPTY);
  return npl;
}

function R_MakeSpans(x: number, t1: number, b1: number, t2: number, b2: number): void {
  while (t1 < t2 && t1 <= b1) {
    R_MapPlane(t1, spanstart[t1], x - 1);
    t1++;
  }
  while (b1 > b2 && b1 >= t1) {
    R_MapPlane(b1, spanstart[b1], x - 1);
    b1--;
  }
  while (t2 < t1 && t2 <= b2) {
    spanstart[t2] = x;
    t2++;
  }
  while (b2 > b1 && b2 >= t2) {
    spanstart[b2] = x;
    b2--;
  }
}

/** Visplane sentinel 0xffff must behave like vanilla's byte 0xff (=255 > any row) in R_MakeSpans. */
function vpTop(v: number): number {
  return v === VP_EMPTY ? 0x7fff : v;
}

function R_DrawPlanes(): void {
  for (let i = 0; i < lastvisplane; i++) {
    const pl = visplanes[i];
    if (pl.minx > pl.maxx) continue;
    if (pl.picnum === g.skyflatnum) {
      dc_iscale = pspriteiscale >> detailshift;
      dc_colormap = 0;
      dc_texturemid = skytexturemid;
      for (let x = pl.minx; x <= pl.maxx; x++) {
        dc_yl = pl.top[x + 1];
        dc_yh = pl.bottom[x + 1];
        if (dc_yl !== VP_EMPTY && dc_yl <= dc_yh) {
          const angle = ((viewangle + xtoviewangle[x]) >>> 0) >>> ANGLETOSKYSHIFT;
          dc_x = x;
          dc_source = R_GetColumn(g.skytexture, angle);
          dc_srcofs = getcolumnofs;
          colfunc();
        }
      }
      continue;
    }
    ds_source = wad.bytesNum(firstflat + flattranslation[pl.picnum]);
    planeheight = Math.abs((pl.height - viewz) | 0);
    let light = (pl.lightlevel >> LIGHTSEGSHIFT) + extralight;
    if (light >= LIGHTLEVELS) light = LIGHTLEVELS - 1;
    if (light < 0) light = 0;
    planezlight = zlight[light];
    pl.top[pl.maxx + 2] = VP_EMPTY;
    pl.top[pl.minx] = VP_EMPTY;
    const stop = pl.maxx + 1;
    for (let x = pl.minx; x <= stop; x++) {
      R_MakeSpans(x, vpTop(pl.top[x]), pl.bottom[x], vpTop(pl.top[x + 1]), pl.bottom[x + 1]);
    }
  }
}

// ---------------------------------------------------------------- sky (r_sky.c)
export let skytexturemid = 100 * FRACUNIT;
export function R_InitSkyMap(): void {
  skytexturemid = 100 * FRACUNIT;
}

// ---------------------------------------------------------------- BSP traversal (r_bsp.c)
let curline: Seg;
let sidedef: Side;
let linedef: Line;
let frontsector: Sector;
let backsector: Sector | null;

class DrawSeg {
  curline!: Seg;
  x1 = 0;
  x2 = 0;
  scale1 = 0;
  scale2 = 0;
  scalestep = 0;
  silhouette = 0;
  bsilheight = 0;
  tsilheight = 0;
  sprtopclip: Int16Array | null = null;
  sprtopclipOfs = 0;
  sprbottomclip: Int16Array | null = null;
  sprbottomclipOfs = 0;
  maskedtexturecol: Int16Array | null = null;
  maskedtexturecolOfs = 0;
}
const drawsegs: DrawSeg[] = Array.from({ length: MAXDRAWSEGS }, () => new DrawSeg());
let ds_p = 0;

function R_ClearDrawSegs(): void {
  ds_p = 0;
}

const solidsegs = Array.from({ length: MAXSEGS + 1 }, () => ({ first: 0, last: 0 }));
let newend = 0;

function R_ClipSolidWallSegment(first: number, last: number): void {
  let start = 0;
  while (solidsegs[start].last < first - 1) start++;
  if (first < solidsegs[start].first) {
    if (last < solidsegs[start].first - 1) {
      R_StoreWallRange(first, last);
      let next = newend;
      newend++;
      if (newend > MAXSEGS) newend = MAXSEGS; // vanilla would overflow memory here
      while (next !== start) {
        solidsegs[next].first = solidsegs[next - 1].first;
        solidsegs[next].last = solidsegs[next - 1].last;
        next--;
      }
      solidsegs[next].first = first;
      solidsegs[next].last = last;
      return;
    }
    R_StoreWallRange(first, solidsegs[start].first - 1);
    solidsegs[start].first = first;
  }
  if (last <= solidsegs[start].last) return;
  let next = start;
  let crunch = false;
  while (last >= solidsegs[next + 1].first - 1) {
    R_StoreWallRange(solidsegs[next].last + 1, solidsegs[next + 1].first - 1);
    next++;
    if (last <= solidsegs[next].last) {
      solidsegs[start].last = solidsegs[next].last;
      crunch = true;
      break;
    }
  }
  if (!crunch) {
    R_StoreWallRange(solidsegs[next].last + 1, last);
    solidsegs[start].last = last;
  }
  if (next === start) return;
  while (next++ !== newend) {
    ++start;
    solidsegs[start].first = solidsegs[next]?.first ?? 0;
    solidsegs[start].last = solidsegs[next]?.last ?? 0;
  }
  newend = start + 1;
}

function R_ClipPassWallSegment(first: number, last: number): void {
  let start = 0;
  while (solidsegs[start].last < first - 1) start++;
  if (first < solidsegs[start].first) {
    if (last < solidsegs[start].first - 1) {
      R_StoreWallRange(first, last);
      return;
    }
    R_StoreWallRange(first, solidsegs[start].first - 1);
  }
  if (last <= solidsegs[start].last) return;
  while (last >= solidsegs[start + 1].first - 1) {
    R_StoreWallRange(solidsegs[start].last + 1, solidsegs[start + 1].first - 1);
    start++;
    if (last <= solidsegs[start].last) return;
  }
  R_StoreWallRange(solidsegs[start].last + 1, last);
}

function R_ClearClipSegs(): void {
  solidsegs[0].first = -0x7fffffff;
  solidsegs[0].last = -1;
  solidsegs[1].first = viewwidth;
  solidsegs[1].last = 0x7fffffff;
  newend = 2;
}

let rw_angle1 = 0;

function R_AddLine(line: Seg): void {
  curline = line;
  let angle1 = R_PointToAngle(line.v1.x, line.v1.y);
  let angle2 = R_PointToAngle(line.v2.x, line.v2.y);
  const span = (angle1 - angle2) >>> 0;
  if (span >= ANG180) return;
  rw_angle1 = angle1;
  angle1 = (angle1 - viewangle) >>> 0;
  angle2 = (angle2 - viewangle) >>> 0;
  let tspan = (angle1 + clipangle) >>> 0;
  if (tspan > 2 * clipangle) {
    tspan = (tspan - 2 * clipangle) >>> 0;
    if (tspan >= span) return;
    angle1 = clipangle;
  }
  tspan = (clipangle - angle2) >>> 0;
  if (tspan > 2 * clipangle) {
    tspan = (tspan - 2 * clipangle) >>> 0;
    if (tspan >= span) return;
    angle2 = -clipangle >>> 0;
  }
  angle1 = ((angle1 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
  angle2 = ((angle2 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
  const x1 = viewangletox[angle1];
  const x2 = viewangletox[angle2];
  if (x1 === x2) return;
  backsector = line.backsector;
  if (!backsector) {
    R_ClipSolidWallSegment(x1, x2 - 1);
    return;
  }
  if (backsector.ceilingheight <= frontsector.floorheight || backsector.floorheight >= frontsector.ceilingheight) {
    R_ClipSolidWallSegment(x1, x2 - 1);
    return;
  }
  if (backsector.ceilingheight !== frontsector.ceilingheight || backsector.floorheight !== frontsector.floorheight) {
    R_ClipPassWallSegment(x1, x2 - 1);
    return;
  }
  if (
    backsector.ceilingpic === frontsector.ceilingpic && backsector.floorpic === frontsector.floorpic &&
    backsector.lightlevel === frontsector.lightlevel && curline.sidedef.midtexture === 0
  ) return;
  R_ClipPassWallSegment(x1, x2 - 1);
}

const checkcoord = [
  [3, 0, 2, 1], [3, 0, 2, 0], [3, 1, 2, 0], [0, 0, 0, 0], [2, 0, 2, 1], [0, 0, 0, 0],
  [3, 1, 3, 0], [0, 0, 0, 0], [2, 0, 3, 1], [2, 1, 3, 1], [2, 1, 3, 0], [0, 0, 0, 0],
];

function R_CheckBBox(bspcoord: number[]): boolean {
  let boxx: number, boxy: number;
  if (viewx <= bspcoord[BOXLEFT]) boxx = 0;
  else if (viewx < bspcoord[BOXRIGHT]) boxx = 1;
  else boxx = 2;
  if (viewy >= bspcoord[BOXTOP]) boxy = 0;
  else if (viewy > bspcoord[BOXBOTTOM]) boxy = 1;
  else boxy = 2;
  const boxpos = (boxy << 2) + boxx;
  if (boxpos === 5) return true;
  const cc = checkcoord[boxpos];
  const x1 = bspcoord[cc[0]], y1 = bspcoord[cc[1]], x2 = bspcoord[cc[2]], y2 = bspcoord[cc[3]];
  let angle1 = (R_PointToAngle(x1, y1) - viewangle) >>> 0;
  let angle2 = (R_PointToAngle(x2, y2) - viewangle) >>> 0;
  const span = (angle1 - angle2) >>> 0;
  if (span >= ANG180) return true;
  let tspan = (angle1 + clipangle) >>> 0;
  if (tspan > 2 * clipangle) {
    tspan = (tspan - 2 * clipangle) >>> 0;
    if (tspan >= span) return false;
    angle1 = clipangle;
  }
  tspan = (clipangle - angle2) >>> 0;
  if (tspan > 2 * clipangle) {
    tspan = (tspan - 2 * clipangle) >>> 0;
    if (tspan >= span) return false;
    angle2 = -clipangle >>> 0;
  }
  angle1 = ((angle1 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
  angle2 = ((angle2 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
  const sx1 = viewangletox[angle1];
  let sx2 = viewangletox[angle2];
  if (sx1 === sx2) return false;
  sx2--;
  let start = 0;
  while (solidsegs[start].last < sx2) start++;
  if (sx1 >= solidsegs[start].first && sx2 <= solidsegs[start].last) return false;
  return true;
}

function R_Subsector(num: number): void {
  const sub = lv.subsectors[num];
  frontsector = sub.sector;
  let count = sub.numlines;
  let line = sub.firstline;
  floorplane = frontsector.floorheight < viewz ? R_FindPlane(frontsector.floorheight, frontsector.floorpic, frontsector.lightlevel) : null;
  ceilingplane = frontsector.ceilingheight > viewz || frontsector.ceilingpic === g.skyflatnum
    ? R_FindPlane(frontsector.ceilingheight, frontsector.ceilingpic, frontsector.lightlevel) : null;
  R_AddSprites(frontsector);
  while (count--) R_AddLine(lv.segs[line++]);
}

function R_RenderBSPNode(bspnum: number): void {
  if (bspnum & NF_SUBSECTOR) {
    if (bspnum === -1) R_Subsector(0);
    else R_Subsector(bspnum & ~NF_SUBSECTOR);
    return;
  }
  const bsp = lv.nodes[bspnum];
  const side = R_PointOnSide(viewx, viewy, bsp);
  R_RenderBSPNode(bsp.children[side]);
  if (R_CheckBBox(bsp.bbox[side ^ 1])) R_RenderBSPNode(bsp.children[side ^ 1]);
}

// ---------------------------------------------------------------- walls (r_segs.c)
let segtextured = false;
let markfloor = false;
let markceiling = false;
let maskedtexture = false;
let toptexture = 0;
let bottomtexture = 0;
let midtexture = 0;
let rw_x = 0;
let rw_stopx = 0;
let rw_centerangle = 0;
let rw_offset = 0;
let rw_scale = 0;
let rw_scalestep = 0;
let rw_midtexturemid = 0;
let rw_toptexturemid = 0;
let rw_bottomtexturemid = 0;
let worldtop = 0;
let worldbottom = 0;
let worldhigh = 0;
let worldlow = 0;
let pixhigh = 0;
let pixlow = 0;
let pixhighstep = 0;
let pixlowstep = 0;
let topfrac = 0;
let topstep = 0;
let bottomfrac = 0;
let bottomstep = 0;
let maskedtexturecolOfs = 0; // into `openings`

// masked drawing state (r_things.c)
let mfloorclip: Int16Array = negonearray;
let mfloorclipOfs = 0;
let mceilingclip: Int16Array = negonearray;
let mceilingclipOfs = 0;
let spryscale = 0;
let sprtopscreen = 0;

function lightShift(): number {
  return LIGHTSCALESHIFT + hires;
}

function R_RenderMaskedSegRange(ds: DrawSeg, x1: number, x2: number): void {
  curline = ds.curline;
  frontsector = curline.frontsector;
  backsector = curline.backsector!;
  const texnum = texturetranslation[curline.sidedef.midtexture];
  let lightnum = (frontsector.lightlevel >> LIGHTSEGSHIFT) + extralight;
  if (curline.v1.y === curline.v2.y) lightnum--;
  else if (curline.v1.x === curline.v2.x) lightnum++;
  if (lightnum < 0) walllights = scalelight[0];
  else if (lightnum >= LIGHTLEVELS) walllights = scalelight[LIGHTLEVELS - 1];
  else walllights = scalelight[lightnum];
  const mtc = ds.maskedtexturecol!;
  const mtcOfs = ds.maskedtexturecolOfs;
  rw_scalestep = ds.scalestep;
  spryscale = (ds.scale1 + (x1 - ds.x1) * rw_scalestep) | 0;
  mfloorclip = ds.sprbottomclip!;
  mfloorclipOfs = ds.sprbottomclipOfs;
  mceilingclip = ds.sprtopclip!;
  mceilingclipOfs = ds.sprtopclipOfs;
  if (curline.linedef.flags & ML_DONTPEGBOTTOM) {
    dc_texturemid = frontsector.floorheight > backsector.floorheight ? frontsector.floorheight : backsector.floorheight;
    dc_texturemid = (dc_texturemid + textureheight[texnum] - viewz) | 0;
  } else {
    dc_texturemid = frontsector.ceilingheight < backsector.ceilingheight ? frontsector.ceilingheight : backsector.ceilingheight;
    dc_texturemid = (dc_texturemid - viewz) | 0;
  }
  dc_texturemid = (dc_texturemid + curline.sidedef.rowoffset) | 0;
  if (fixedcolormap >= 0) dc_colormap = fixedcolormap;
  for (dc_x = x1; dc_x <= x2; dc_x++) {
    if (mtc[mtcOfs + dc_x] !== MAXSHORT) {
      if (fixedcolormap < 0) {
        let index = spryscale >>> lightShift();
        if (index >= MAXLIGHTSCALE) index = MAXLIGHTSCALE - 1;
        dc_colormap = walllights[index];
      }
      sprtopscreen = (centeryfrac - FixedMul(dc_texturemid, spryscale)) | 0;
      dc_iscale = Math.floor(0xffffffff / (spryscale >>> 0)) | 0;
      const buf = R_GetColumn(texnum, mtc[mtcOfs + dc_x]);
      R_DrawMaskedColumn(buf, getcolumnofs - 3);
      mtc[mtcOfs + dc_x] = MAXSHORT;
    }
    spryscale = (spryscale + rw_scalestep) | 0;
  }
}

function R_RenderSegLoop(): void {
  let texturecolumn = 0;
  const mtcOfs = maskedtexturecolOfs;
  for (; rw_x < rw_stopx; rw_x++) {
    let yl = (topfrac + HEIGHTUNIT - 1) >> HEIGHTBITS;
    if (yl < ceilingclip[rw_x] + 1) yl = ceilingclip[rw_x] + 1;
    if (markceiling) {
      const top = ceilingclip[rw_x] + 1;
      let bottom = yl - 1;
      if (bottom >= floorclip[rw_x]) bottom = floorclip[rw_x] - 1;
      if (top <= bottom) {
        ceilingplane!.top[rw_x + 1] = top;
        ceilingplane!.bottom[rw_x + 1] = bottom;
      }
    }
    let yh = bottomfrac >> HEIGHTBITS;
    if (yh >= floorclip[rw_x]) yh = floorclip[rw_x] - 1;
    if (markfloor) {
      let top = yh + 1;
      const bottom = floorclip[rw_x] - 1;
      if (top <= ceilingclip[rw_x]) top = ceilingclip[rw_x] + 1;
      if (top <= bottom) {
        floorplane!.top[rw_x + 1] = top;
        floorplane!.bottom[rw_x + 1] = bottom;
      }
    }
    if (segtextured) {
      const angle = ((rw_centerangle + xtoviewangle[rw_x]) >>> 0) >>> ANGLETOFINESHIFT;
      texturecolumn = (rw_offset - FixedMul(finetangent[angle], rw_distance)) | 0;
      texturecolumn >>= FRACBITS;
      let index = rw_scale >>> lightShift();
      if (index >= MAXLIGHTSCALE) index = MAXLIGHTSCALE - 1;
      dc_colormap = walllights[index];
      dc_x = rw_x;
      dc_iscale = Math.floor(0xffffffff / (rw_scale >>> 0)) | 0;
    }
    if (midtexture) {
      dc_yl = yl;
      dc_yh = yh;
      dc_texturemid = rw_midtexturemid;
      dc_source = R_GetColumn(midtexture, texturecolumn);
      dc_srcofs = getcolumnofs;
      colfunc();
      ceilingclip[rw_x] = viewheight;
      floorclip[rw_x] = -1;
    } else {
      if (toptexture) {
        let mid = pixhigh >> HEIGHTBITS;
        pixhigh = (pixhigh + pixhighstep) | 0;
        if (mid >= floorclip[rw_x]) mid = floorclip[rw_x] - 1;
        if (mid >= yl) {
          dc_yl = yl;
          dc_yh = mid;
          dc_texturemid = rw_toptexturemid;
          dc_source = R_GetColumn(toptexture, texturecolumn);
          dc_srcofs = getcolumnofs;
          colfunc();
          ceilingclip[rw_x] = mid;
        } else ceilingclip[rw_x] = yl - 1;
      } else if (markceiling) ceilingclip[rw_x] = yl - 1;

      if (bottomtexture) {
        let mid = (pixlow + HEIGHTUNIT - 1) >> HEIGHTBITS;
        pixlow = (pixlow + pixlowstep) | 0;
        if (mid <= ceilingclip[rw_x]) mid = ceilingclip[rw_x] + 1;
        if (mid <= yh) {
          dc_yl = mid;
          dc_yh = yh;
          dc_texturemid = rw_bottomtexturemid;
          dc_source = R_GetColumn(bottomtexture, texturecolumn);
          dc_srcofs = getcolumnofs;
          colfunc();
          floorclip[rw_x] = mid;
        } else floorclip[rw_x] = yh + 1;
      } else if (markfloor) floorclip[rw_x] = yh + 1;

      if (maskedtexture) openings[mtcOfs + rw_x] = texturecolumn;
    }
    rw_scale = (rw_scale + rw_scalestep) | 0;
    topfrac = (topfrac + topstep) | 0;
    bottomfrac = (bottomfrac + bottomstep) | 0;
  }
}

function R_StoreWallRange(start: number, stop: number): void {
  if (ds_p === MAXDRAWSEGS) return;
  if (start >= viewwidth || start > stop) return;
  const ds = drawsegs[ds_p];
  sidedef = curline.sidedef;
  linedef = curline.linedef;
  linedef.flags |= ML_MAPPED;
  rw_normalangle = (curline.angle + ANG90) >>> 0;
  // abs() of an angle_t difference, as the C code does (int conversion).
  let offsetangle = Math.abs((rw_normalangle - rw_angle1) | 0) >>> 0;
  if (offsetangle > ANG90) offsetangle = ANG90;
  const distangle = (ANG90 - offsetangle) >>> 0;
  const hyp = R_PointToDist(curline.v1.x, curline.v1.y);
  let sineval = finesine[distangle >>> ANGLETOFINESHIFT];
  rw_distance = FixedMul(hyp, sineval);

  ds.x1 = rw_x = start;
  ds.x2 = stop;
  ds.curline = curline;
  rw_stopx = stop + 1;
  ds.scale1 = rw_scale = R_ScaleFromGlobalAngle((viewangle + xtoviewangle[start]) >>> 0);
  if (stop > start) {
    ds.scale2 = R_ScaleFromGlobalAngle((viewangle + xtoviewangle[stop]) >>> 0);
    ds.scalestep = rw_scalestep = ((ds.scale2 - rw_scale) / (stop - start)) | 0;
  } else {
    ds.scale2 = ds.scale1;
  }

  worldtop = (frontsector.ceilingheight - viewz) | 0;
  worldbottom = (frontsector.floorheight - viewz) | 0;
  midtexture = toptexture = bottomtexture = 0;
  maskedtexture = false;
  ds.maskedtexturecol = null;

  if (!backsector) {
    midtexture = texturetranslation[sidedef.midtexture];
    markfloor = markceiling = true;
    if (linedef.flags & ML_DONTPEGBOTTOM) {
      const vtop = (frontsector.floorheight + textureheight[sidedef.midtexture]) | 0;
      rw_midtexturemid = (vtop - viewz) | 0;
    } else rw_midtexturemid = worldtop;
    rw_midtexturemid = (rw_midtexturemid + sidedef.rowoffset) | 0;
    ds.silhouette = SIL_BOTH;
    ds.sprtopclip = screenheightarray;
    ds.sprtopclipOfs = 0;
    ds.sprbottomclip = negonearray;
    ds.sprbottomclipOfs = 0;
    ds.bsilheight = MAXINT;
    ds.tsilheight = MININT;
  } else {
    ds.sprtopclip = ds.sprbottomclip = null;
    ds.silhouette = 0;
    if (frontsector.floorheight > backsector.floorheight) {
      ds.silhouette = SIL_BOTTOM;
      ds.bsilheight = frontsector.floorheight;
    } else if (backsector.floorheight > viewz) {
      ds.silhouette = SIL_BOTTOM;
      ds.bsilheight = MAXINT;
    }
    if (frontsector.ceilingheight < backsector.ceilingheight) {
      ds.silhouette |= SIL_TOP;
      ds.tsilheight = frontsector.ceilingheight;
    } else if (backsector.ceilingheight < viewz) {
      ds.silhouette |= SIL_TOP;
      ds.tsilheight = MININT;
    }
    if (backsector.ceilingheight <= frontsector.floorheight) {
      ds.sprbottomclip = negonearray;
      ds.sprbottomclipOfs = 0;
      ds.bsilheight = MAXINT;
      ds.silhouette |= SIL_BOTTOM;
    }
    if (backsector.floorheight >= frontsector.ceilingheight) {
      ds.sprtopclip = screenheightarray;
      ds.sprtopclipOfs = 0;
      ds.tsilheight = MININT;
      ds.silhouette |= SIL_TOP;
    }
    worldhigh = (backsector.ceilingheight - viewz) | 0;
    worldlow = (backsector.floorheight - viewz) | 0;
    if (frontsector.ceilingpic === g.skyflatnum && backsector.ceilingpic === g.skyflatnum) worldtop = worldhigh;

    markfloor = worldlow !== worldbottom || backsector.floorpic !== frontsector.floorpic || backsector.lightlevel !== frontsector.lightlevel;
    markceiling = worldhigh !== worldtop || backsector.ceilingpic !== frontsector.ceilingpic || backsector.lightlevel !== frontsector.lightlevel;
    if (backsector.ceilingheight <= frontsector.floorheight || backsector.floorheight >= frontsector.ceilingheight) markceiling = markfloor = true;

    if (worldhigh < worldtop) {
      toptexture = texturetranslation[sidedef.toptexture];
      if (linedef.flags & ML_DONTPEGTOP) rw_toptexturemid = worldtop;
      else {
        const vtop = (backsector.ceilingheight + textureheight[sidedef.toptexture]) | 0;
        rw_toptexturemid = (vtop - viewz) | 0;
      }
    }
    if (worldlow > worldbottom) {
      bottomtexture = texturetranslation[sidedef.bottomtexture];
      if (linedef.flags & ML_DONTPEGBOTTOM) rw_bottomtexturemid = worldtop;
      else rw_bottomtexturemid = worldlow;
    }
    rw_toptexturemid = (rw_toptexturemid + sidedef.rowoffset) | 0;
    rw_bottomtexturemid = (rw_bottomtexturemid + sidedef.rowoffset) | 0;

    if (sidedef.midtexture) {
      maskedtexture = true;
      ds.maskedtexturecol = openings;
      ds.maskedtexturecolOfs = maskedtexturecolOfs = lastopening - rw_x;
      lastopening += rw_stopx - rw_x;
    }
  }

  segtextured = !!(midtexture | toptexture | bottomtexture) || maskedtexture;
  if (segtextured) {
    offsetangle = (rw_normalangle - rw_angle1) >>> 0;
    if (offsetangle > ANG180) offsetangle = -offsetangle >>> 0;
    if (offsetangle > ANG90) offsetangle = ANG90;
    sineval = finesine[offsetangle >>> ANGLETOFINESHIFT];
    rw_offset = FixedMul(hyp, sineval);
    if (((rw_normalangle - rw_angle1) >>> 0) < ANG180) rw_offset = -rw_offset | 0;
    rw_offset = (rw_offset + sidedef.textureoffset + curline.offset) | 0;
    rw_centerangle = (ANG90 + viewangle - rw_normalangle) >>> 0;
    if (fixedcolormap < 0) {
      let lightnum = (frontsector.lightlevel >> LIGHTSEGSHIFT) + extralight;
      if (curline.v1.y === curline.v2.y) lightnum--;
      else if (curline.v1.x === curline.v2.x) lightnum++;
      if (lightnum < 0) walllights = scalelight[0];
      else if (lightnum >= LIGHTLEVELS) walllights = scalelight[LIGHTLEVELS - 1];
      else walllights = scalelight[lightnum];
    }
  }

  if (frontsector.floorheight >= viewz) markfloor = false;
  if (frontsector.ceilingheight <= viewz && frontsector.ceilingpic !== g.skyflatnum) markceiling = false;

  worldtop >>= 4;
  worldbottom >>= 4;
  topstep = -FixedMul(rw_scalestep, worldtop) | 0;
  topfrac = ((centeryfrac >> 4) - FixedMul(worldtop, rw_scale)) | 0;
  bottomstep = -FixedMul(rw_scalestep, worldbottom) | 0;
  bottomfrac = ((centeryfrac >> 4) - FixedMul(worldbottom, rw_scale)) | 0;

  if (backsector) {
    worldhigh >>= 4;
    worldlow >>= 4;
    if (worldhigh < worldtop) {
      pixhigh = ((centeryfrac >> 4) - FixedMul(worldhigh, rw_scale)) | 0;
      pixhighstep = -FixedMul(rw_scalestep, worldhigh) | 0;
    }
    if (worldlow > worldbottom) {
      pixlow = ((centeryfrac >> 4) - FixedMul(worldlow, rw_scale)) | 0;
      pixlowstep = -FixedMul(rw_scalestep, worldlow) | 0;
    }
  }

  if (markceiling) ceilingplane = R_CheckPlane(ceilingplane!, rw_x, rw_stopx - 1);
  if (markfloor) floorplane = R_CheckPlane(floorplane!, rw_x, rw_stopx - 1);

  R_RenderSegLoop();

  if ((ds.silhouette & SIL_TOP || maskedtexture) && !ds.sprtopclip) {
    openings.set(ceilingclip.subarray(start, rw_stopx), lastopening);
    ds.sprtopclip = openings;
    ds.sprtopclipOfs = lastopening - start;
    lastopening += rw_stopx - start;
  }
  if ((ds.silhouette & SIL_BOTTOM || maskedtexture) && !ds.sprbottomclip) {
    openings.set(floorclip.subarray(start, rw_stopx), lastopening);
    ds.sprbottomclip = openings;
    ds.sprbottomclipOfs = lastopening - start;
    lastopening += rw_stopx - start;
  }
  if (maskedtexture && !(ds.silhouette & SIL_TOP)) {
    ds.silhouette |= SIL_TOP;
    ds.tsilheight = MININT;
  }
  if (maskedtexture && !(ds.silhouette & SIL_BOTTOM)) {
    ds.silhouette |= SIL_BOTTOM;
    ds.bsilheight = MAXINT;
  }
  ds_p++;
}

// ---------------------------------------------------------------- sprites (r_things.c)
export interface SpriteFrame { rotate: number; lump: Int16Array; flip: Uint8Array }
export interface SpriteDef { numframes: number; spriteframes: SpriteFrame[] }
export let sprites: SpriteDef[] = [];

export function R_InitSprites(): void {
  sprites = [];
  const start = firstspritelump - 1;
  const end = lastspritelump + 1;
  for (const spritename of sprnames) {
    const sprtemp: SpriteFrame[] = Array.from({ length: 29 }, () => ({ rotate: -1, lump: new Int16Array(8).fill(-1), flip: new Uint8Array(8).fill(0xff) }));
    let maxframe = -1;
    const install = (lump: number, frame: number, rotation: number, flipped: boolean) => {
      if (frame >= 29 || rotation > 8) throw new Error(`R_InstallSpriteLump: Bad frame characters in lump ${lump}`);
      if (frame > maxframe) maxframe = frame;
      const f = sprtemp[frame];
      if (rotation === 0) {
        f.rotate = 0;
        for (let r = 0; r < 8; r++) {
          f.lump[r] = lump - firstspritelump;
          f.flip[r] = flipped ? 1 : 0;
        }
        return;
      }
      f.rotate = 1;
      rotation--;
      f.lump[rotation] = lump - firstspritelump;
      f.flip[rotation] = flipped ? 1 : 0;
    };
    for (let l = start + 1; l < end; l++) {
      const name = wad.lumps[l].name;
      if (name.slice(0, 4) !== spritename) continue;
      install(wad.checkNumForName(name), name.charCodeAt(4) - 65, name.charCodeAt(5) - 48, false);
      if (name.length > 6) install(l, name.charCodeAt(6) - 65, name.charCodeAt(7) - 48, true);
    }
    if (maxframe === -1) {
      sprites.push({ numframes: 0, spriteframes: [] });
      continue;
    }
    maxframe++;
    for (let frame = 0; frame < maxframe; frame++) {
      if (sprtemp[frame].rotate === -1) throw new Error(`R_InitSprites: No patches found for ${spritename} frame ${String.fromCharCode(65 + frame)}`);
      if (sprtemp[frame].rotate === 1) {
        for (let r = 0; r < 8; r++) {
          if (sprtemp[frame].lump[r] === -1) throw new Error(`R_InitSprites: Sprite ${spritename} frame ${String.fromCharCode(65 + frame)} is missing rotations`);
        }
      }
    }
    sprites.push({ numframes: maxframe, spriteframes: sprtemp.slice(0, maxframe) });
  }
}

class VisSprite {
  prev: VisSprite | null = null;
  next: VisSprite | null = null;
  x1 = 0;
  x2 = 0;
  gx = 0;
  gy = 0;
  gz = 0;
  gzt = 0;
  startfrac = 0;
  scale = 0;
  xiscale = 0;
  texturemid = 0;
  patch = 0;
  colormap = 0; // -1 = shadow (fuzz)
  mobjflags = 0;
}
const vissprites: VisSprite[] = Array.from({ length: MAXVISSPRITES }, () => new VisSprite());
const overflowsprite = new VisSprite();
let vissprite_p = 0;

function R_ClearSprites(): void {
  vissprite_p = 0;
}

function R_NewVisSprite(): VisSprite {
  if (vissprite_p === MAXVISSPRITES) return overflowsprite;
  return vissprites[vissprite_p++];
}

function R_DrawMaskedColumn(buf: Uint8Array, p: number): void {
  const basetexturemid = dc_texturemid;
  for (;;) {
    const topdelta = buf[p] ?? 0xff;
    if (topdelta === 0xff) break;
    const length = buf[p + 1] ?? 0;
    const topscreen = (sprtopscreen + spryscale * topdelta) | 0;
    const bottomscreen = (topscreen + spryscale * length) | 0;
    dc_yl = (topscreen + FRACUNIT - 1) >> FRACBITS;
    dc_yh = (bottomscreen - 1) >> FRACBITS;
    if (dc_yh >= mfloorclip[mfloorclipOfs + dc_x]) dc_yh = mfloorclip[mfloorclipOfs + dc_x] - 1;
    if (dc_yl <= mceilingclip[mceilingclipOfs + dc_x]) dc_yl = mceilingclip[mceilingclipOfs + dc_x] + 1;
    if (dc_yl <= dc_yh) {
      dc_source = buf;
      dc_srcofs = p + 3;
      dc_texturemid = (basetexturemid - (topdelta << FRACBITS)) | 0;
      colfunc();
    }
    p += length + 4;
  }
  dc_texturemid = basetexturemid;
}

function R_DrawVisSprite(vis: VisSprite): void {
  const lump = vis.patch + firstspritelump;
  const patch = wad.cacheLumpNum(lump);
  const buf = wad.bytesNum(lump);
  dc_colormap = vis.colormap;
  if (vis.colormap < 0) colfunc = fuzzcolfunc;
  else if (vis.mobjflags & MF_TRANSLATION) {
    colfunc = R_DrawTranslatedColumn;
    dc_translation = -256 + ((vis.mobjflags & MF_TRANSLATION) >> (MF_TRANSSHIFT - 8));
  }
  dc_iscale = Math.abs(vis.xiscale) >> detailshift;
  dc_texturemid = vis.texturemid;
  let frac = vis.startfrac;
  spryscale = vis.scale;
  sprtopscreen = (centeryfrac - FixedMul(dc_texturemid, spryscale)) | 0;
  for (dc_x = vis.x1; dc_x <= vis.x2; dc_x++, frac = (frac + vis.xiscale) | 0) {
    const texturecolumn = frac >> FRACBITS;
    R_DrawMaskedColumn(buf, patchColOfs(patch, texturecolumn));
  }
  colfunc = basecolfunc;
}

function R_ProjectSprite(thing: Mobj): void {
  const tr_x = (thing.x - viewx) | 0;
  const tr_y = (thing.y - viewy) | 0;
  let gxt = FixedMul(tr_x, viewcos);
  let gyt = -FixedMul(tr_y, viewsin) | 0;
  const tz = (gxt - gyt) | 0;
  if (tz < MINZ) return;
  const xscale = FixedDiv(projection, tz);
  gxt = -FixedMul(tr_x, viewsin) | 0;
  gyt = FixedMul(tr_y, viewcos);
  let tx = -(gyt + gxt) | 0;
  if (Math.abs(tx) > tz << 2) return;
  const sprdef = sprites[thing.sprite];
  const sprframe = sprdef.spriteframes[thing.frame & FF_FRAMEMASK];
  if (!sprframe) return;
  let lump: number;
  let flip: boolean;
  if (sprframe.rotate) {
    const ang = R_PointToAngle(thing.x, thing.y);
    const rot = ((ang - thing.angle + ((ANG45H * 9) >>> 0)) >>> 0) >>> 29;
    lump = sprframe.lump[rot];
    flip = !!sprframe.flip[rot];
  } else {
    lump = sprframe.lump[0];
    flip = !!sprframe.flip[0];
  }
  tx = (tx - spriteoffset[lump]) | 0;
  const x1 = (centerxfrac + FixedMul(tx, xscale)) >> FRACBITS;
  if (x1 > viewwidth) return;
  tx = (tx + spritewidth[lump]) | 0;
  const x2 = ((centerxfrac + FixedMul(tx, xscale)) >> FRACBITS) - 1;
  if (x2 < 0) return;
  const vis = R_NewVisSprite();
  vis.mobjflags = thing.flags;
  vis.scale = xscale << detailshift;
  vis.gx = thing.x;
  vis.gy = thing.y;
  vis.gz = thing.z;
  vis.gzt = (thing.z + spritetopoffset[lump]) | 0;
  vis.texturemid = (vis.gzt - viewz) | 0;
  vis.x1 = x1 < 0 ? 0 : x1;
  vis.x2 = x2 >= viewwidth ? viewwidth - 1 : x2;
  const iscale = FixedDiv(FRACUNIT, xscale);
  if (flip) {
    vis.startfrac = spritewidth[lump] - 1;
    vis.xiscale = -iscale | 0;
  } else {
    vis.startfrac = 0;
    vis.xiscale = iscale;
  }
  if (vis.x1 > x1) vis.startfrac = (vis.startfrac + vis.xiscale * (vis.x1 - x1)) | 0;
  vis.patch = lump;
  if (thing.flags & MF_SHADOW) vis.colormap = -1;
  else if (fixedcolormap >= 0) vis.colormap = fixedcolormap;
  else if (thing.frame & FF_FULLBRIGHT) vis.colormap = 0;
  else {
    let index = xscale >> (LIGHTSCALESHIFT - detailshift + hires);
    if (index >= MAXLIGHTSCALE) index = MAXLIGHTSCALE - 1;
    vis.colormap = spritelights[index];
  }
}
const ANG45H = 0x10000000; // (unsigned)(ANG45/2)

function R_AddSprites(sec: Sector): void {
  if (sec.validcount === validcount) return;
  sec.validcount = validcount;
  const lightnum = (sec.lightlevel >> LIGHTSEGSHIFT) + extralight;
  if (lightnum < 0) spritelights = scalelight[0];
  else if (lightnum >= LIGHTLEVELS) spritelights = scalelight[LIGHTLEVELS - 1];
  else spritelights = scalelight[lightnum];
  for (let thing = sec.thinglist; thing; thing = thing.snext) R_ProjectSprite(thing);
}

const avis = new VisSprite();

function R_DrawPSprite(psp: PspDef): void {
  const st = psp.state!;
  const sprdef = sprites[st.sprite];
  const sprframe = sprdef.spriteframes[st.frame & FF_FRAMEMASK];
  if (!sprframe) return;
  const lump = sprframe.lump[0];
  const flip = !!sprframe.flip[0];
  let tx = (psp.sx - 160 * FRACUNIT) | 0;
  tx = (tx - spriteoffset[lump]) | 0;
  const x1 = (centerxfrac + FixedMul(tx, pspritescale)) >> FRACBITS;
  if (x1 > viewwidth) return;
  tx = (tx + spritewidth[lump]) | 0;
  const x2 = ((centerxfrac + FixedMul(tx, pspritescale)) >> FRACBITS) - 1;
  if (x2 < 0) return;
  const vis = avis;
  vis.mobjflags = 0;
  vis.texturemid = ((BASEYCENTER << FRACBITS) + FRACUNIT / 2 - (psp.sy - spritetopoffset[lump])) | 0;
  vis.x1 = x1 < 0 ? 0 : x1;
  vis.x2 = x2 >= viewwidth ? viewwidth - 1 : x2;
  vis.scale = pspritescale << detailshift;
  if (flip) {
    vis.xiscale = -pspriteiscale;
    vis.startfrac = spritewidth[lump] - 1;
  } else {
    vis.xiscale = pspriteiscale;
    vis.startfrac = 0;
  }
  if (vis.x1 > x1) vis.startfrac = (vis.startfrac + vis.xiscale * (vis.x1 - x1)) | 0;
  vis.patch = lump;
  const inv = viewplayer.powers[Power.pw_invisibility];
  if (inv > 4 * 32 || inv & 8) vis.colormap = -1;
  else if (fixedcolormap >= 0) vis.colormap = fixedcolormap;
  else if (st.frame & FF_FULLBRIGHT) vis.colormap = 0;
  else vis.colormap = spritelights[MAXLIGHTSCALE - 1];
  R_DrawVisSprite(vis);
}

function R_DrawPlayerSprites(): void {
  const lightnum = (viewplayer.mo!.subsector.sector.lightlevel >> LIGHTSEGSHIFT) + extralight;
  if (lightnum < 0) spritelights = scalelight[0];
  else if (lightnum >= LIGHTLEVELS) spritelights = scalelight[LIGHTLEVELS - 1];
  else spritelights = scalelight[lightnum];
  mfloorclip = screenheightarray;
  mfloorclipOfs = 0;
  mceilingclip = negonearray;
  mceilingclipOfs = 0;
  for (const psp of viewplayer.psprites) if (psp.state) R_DrawPSprite(psp);
}

const vsprsortedhead = new VisSprite();

function R_SortVisSprites(): void {
  const count = vissprite_p;
  if (!count) return;
  const unsorted = new VisSprite();
  for (let i = 0; i < count; i++) {
    vissprites[i].next = vissprites[i + 1] ?? null;
    vissprites[i].prev = vissprites[i - 1] ?? null;
  }
  vissprites[0].prev = unsorted;
  unsorted.next = vissprites[0];
  vissprites[count - 1].next = unsorted;
  unsorted.prev = vissprites[count - 1];
  vsprsortedhead.next = vsprsortedhead.prev = vsprsortedhead;
  for (let i = 0; i < count; i++) {
    let bestscale = MAXINT;
    let best = unsorted.next!;
    for (let ds = unsorted.next!; ds !== unsorted; ds = ds.next!) {
      if (ds.scale < bestscale) {
        bestscale = ds.scale;
        best = ds;
      }
    }
    best.next!.prev = best.prev;
    best.prev!.next = best.next;
    best.next = vsprsortedhead;
    best.prev = vsprsortedhead.prev;
    vsprsortedhead.prev!.next = best;
    vsprsortedhead.prev = best;
  }
}

let clipbot = new Int16Array(SCREENWIDTH);
let cliptop = new Int16Array(SCREENWIDTH);

function R_DrawSprite(spr: VisSprite): void {
  for (let x = spr.x1; x <= spr.x2; x++) clipbot[x] = cliptop[x] = -2;
  for (let i = ds_p - 1; i >= 0; i--) {
    const ds = drawsegs[i];
    if (ds.x1 > spr.x2 || ds.x2 < spr.x1 || (!ds.silhouette && !ds.maskedtexturecol)) continue;
    const r1 = ds.x1 < spr.x1 ? spr.x1 : ds.x1;
    const r2 = ds.x2 > spr.x2 ? spr.x2 : ds.x2;
    let lowscale: number, scale: number;
    if (ds.scale1 > ds.scale2) {
      lowscale = ds.scale2;
      scale = ds.scale1;
    } else {
      lowscale = ds.scale1;
      scale = ds.scale2;
    }
    if (scale < spr.scale || (lowscale < spr.scale && !R_PointOnSegSide(spr.gx, spr.gy, ds.curline))) {
      if (ds.maskedtexturecol) R_RenderMaskedSegRange(ds, r1, r2);
      continue;
    }
    let silhouette = ds.silhouette;
    if (spr.gz >= ds.bsilheight) silhouette &= ~SIL_BOTTOM;
    if (spr.gzt <= ds.tsilheight) silhouette &= ~SIL_TOP;
    if (silhouette === 1) {
      for (let x = r1; x <= r2; x++) if (clipbot[x] === -2) clipbot[x] = ds.sprbottomclip![ds.sprbottomclipOfs + x];
    } else if (silhouette === 2) {
      for (let x = r1; x <= r2; x++) if (cliptop[x] === -2) cliptop[x] = ds.sprtopclip![ds.sprtopclipOfs + x];
    } else if (silhouette === 3) {
      for (let x = r1; x <= r2; x++) {
        if (clipbot[x] === -2) clipbot[x] = ds.sprbottomclip![ds.sprbottomclipOfs + x];
        if (cliptop[x] === -2) cliptop[x] = ds.sprtopclip![ds.sprtopclipOfs + x];
      }
    }
  }
  for (let x = spr.x1; x <= spr.x2; x++) {
    if (clipbot[x] === -2) clipbot[x] = viewheight;
    if (cliptop[x] === -2) cliptop[x] = -1;
  }
  mfloorclip = clipbot;
  mfloorclipOfs = 0;
  mceilingclip = cliptop;
  mceilingclipOfs = 0;
  R_DrawVisSprite(spr);
}

function R_DrawMasked(): void {
  R_SortVisSprites();
  if (vissprite_p > 0) {
    for (let spr = vsprsortedhead.next!; spr !== vsprsortedhead; spr = spr.next!) R_DrawSprite(spr);
  }
  for (let i = ds_p - 1; i >= 0; i--) {
    const ds = drawsegs[i];
    if (ds.maskedtexturecol) R_RenderMaskedSegRange(ds, ds.x1, ds.x2);
  }
  if (!g.viewangleoffset) R_DrawPlayerSprites();
}

// Re-run the view setup when the internal resolution changes.
onVideoResize(() => {
  if (colormaps) R_SetViewSize(setblocks, setdetail);
});

export { SIL_NONE };

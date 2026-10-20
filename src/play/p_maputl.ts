// p_maputl.c — geometry utilities, blockmap iteration and intercept traversal.
import { FRACBITS, FRACUNIT, FixedMul, FixedDiv, MAXINT } from '../core/fixed';
import {
  MF_NOSECTOR, MF_NOBLOCKMAP, MAPBLOCKSHIFT, MAPBLOCKSIZE, MAPBTOFRAC, PT_EARLYOUT, PT_ADDLINES, PT_ADDTHINGS,
  SlopeType, BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT, type Line, type Mobj,
} from '../doom/defs';
import { g } from '../doom/state';
import { lv } from './p_setup';
import { R_PointInSubsector } from '../render/renderer';

export interface DivLine { x: number; y: number; dx: number; dy: number }
export interface Intercept { frac: number; isaline: boolean; line: Line | null; thing: Mobj | null }
export type Traverser = (inter: Intercept) => boolean;

export function P_AproxDistance(dx: number, dy: number): number {
  dx = Math.abs(dx | 0) | 0;
  dy = Math.abs(dy | 0) | 0;
  if (dx < dy) return (dx + dy - (dx >> 1)) | 0;
  return (dx + dy - (dy >> 1)) | 0;
}

export function P_PointOnLineSide(x: number, y: number, line: Line): number {
  if (!line.dx) {
    if (x <= line.v1.x) return line.dy > 0 ? 1 : 0;
    return line.dy < 0 ? 1 : 0;
  }
  if (!line.dy) {
    if (y <= line.v1.y) return line.dx < 0 ? 1 : 0;
    return line.dx > 0 ? 1 : 0;
  }
  const dx = (x - line.v1.x) | 0;
  const dy = (y - line.v1.y) | 0;
  const left = FixedMul(line.dy >> FRACBITS, dx);
  const right = FixedMul(dy, line.dx >> FRACBITS);
  if (right < left) return 0;
  return 1;
}

export function P_BoxOnLineSide(tmbox: number[], ld: Line): number {
  let p1 = 0, p2 = 0;
  switch (ld.slopetype) {
    case SlopeType.ST_HORIZONTAL:
      p1 = tmbox[BOXTOP] > ld.v1.y ? 1 : 0;
      p2 = tmbox[BOXBOTTOM] > ld.v1.y ? 1 : 0;
      if (ld.dx < 0) {
        p1 ^= 1;
        p2 ^= 1;
      }
      break;
    case SlopeType.ST_VERTICAL:
      p1 = tmbox[BOXRIGHT] < ld.v1.x ? 1 : 0;
      p2 = tmbox[BOXLEFT] < ld.v1.x ? 1 : 0;
      if (ld.dy < 0) {
        p1 ^= 1;
        p2 ^= 1;
      }
      break;
    case SlopeType.ST_POSITIVE:
      p1 = P_PointOnLineSide(tmbox[BOXLEFT], tmbox[BOXTOP], ld);
      p2 = P_PointOnLineSide(tmbox[BOXRIGHT], tmbox[BOXBOTTOM], ld);
      break;
    case SlopeType.ST_NEGATIVE:
      p1 = P_PointOnLineSide(tmbox[BOXRIGHT], tmbox[BOXTOP], ld);
      p2 = P_PointOnLineSide(tmbox[BOXLEFT], tmbox[BOXBOTTOM], ld);
      break;
  }
  if (p1 === p2) return p1;
  return -1;
}

export function P_PointOnDivlineSide(x: number, y: number, line: DivLine): number {
  if (!line.dx) {
    if (x <= line.x) return line.dy > 0 ? 1 : 0;
    return line.dy < 0 ? 1 : 0;
  }
  if (!line.dy) {
    if (y <= line.y) return line.dx < 0 ? 1 : 0;
    return line.dx > 0 ? 1 : 0;
  }
  const dx = (x - line.x) | 0;
  const dy = (y - line.y) | 0;
  if ((line.dy ^ line.dx ^ dx ^ dy) & 0x80000000) {
    if ((line.dy ^ dx) & 0x80000000) return 1;
    return 0;
  }
  const left = FixedMul(line.dy >> 8, dx >> 8);
  const right = FixedMul(dy >> 8, line.dx >> 8);
  if (right < left) return 0;
  return 1;
}

export function P_MakeDivline(li: Line, dl: DivLine): void {
  dl.x = li.v1.x;
  dl.y = li.v1.y;
  dl.dx = li.dx;
  dl.dy = li.dy;
}

export function P_InterceptVector(v2: DivLine, v1: DivLine): number {
  const den = (FixedMul(v1.dy >> 8, v2.dx) - FixedMul(v1.dx >> 8, v2.dy)) | 0;
  if (den === 0) return 0;
  const num = (FixedMul(((v1.x - v2.x) | 0) >> 8, v1.dy) + FixedMul(((v2.y - v1.y) | 0) >> 8, v1.dx)) | 0;
  return FixedDiv(num, den);
}

/** Results of P_LineOpening. */
export const opening = { opentop: 0, openbottom: 0, openrange: 0, lowfloor: 0 };

export function P_LineOpening(linedef: Line): void {
  if (linedef.sidenum[1] === -1) {
    opening.openrange = 0;
    return;
  }
  const front = linedef.frontsector!;
  const back = linedef.backsector!;
  opening.opentop = front.ceilingheight < back.ceilingheight ? front.ceilingheight : back.ceilingheight;
  if (front.floorheight > back.floorheight) {
    opening.openbottom = front.floorheight;
    opening.lowfloor = back.floorheight;
  } else {
    opening.openbottom = back.floorheight;
    opening.lowfloor = front.floorheight;
  }
  opening.openrange = (opening.opentop - opening.openbottom) | 0;
}

export function P_UnsetThingPosition(thing: Mobj): void {
  if (!(thing.flags & MF_NOSECTOR)) {
    if (thing.snext) thing.snext.sprev = thing.sprev;
    if (thing.sprev) thing.sprev.snext = thing.snext;
    else thing.subsector.sector.thinglist = thing.snext;
  }
  if (!(thing.flags & MF_NOBLOCKMAP)) {
    if (thing.bnext) thing.bnext.bprev = thing.bprev;
    if (thing.bprev) thing.bprev.bnext = thing.bnext;
    else {
      const blockx = ((thing.x - lv.bmaporgx) | 0) >> MAPBLOCKSHIFT;
      const blocky = ((thing.y - lv.bmaporgy) | 0) >> MAPBLOCKSHIFT;
      if (blockx >= 0 && blockx < lv.bmapwidth && blocky >= 0 && blocky < lv.bmapheight) {
        lv.blocklinks[blocky * lv.bmapwidth + blockx] = thing.bnext;
      }
    }
  }
}

export function P_SetThingPosition(thing: Mobj): void {
  const ss = R_PointInSubsector(thing.x, thing.y);
  thing.subsector = ss;
  if (!(thing.flags & MF_NOSECTOR)) {
    const sec = ss.sector;
    thing.sprev = null;
    thing.snext = sec.thinglist;
    if (sec.thinglist) sec.thinglist.sprev = thing;
    sec.thinglist = thing;
  }
  if (!(thing.flags & MF_NOBLOCKMAP)) {
    const blockx = ((thing.x - lv.bmaporgx) | 0) >> MAPBLOCKSHIFT;
    const blocky = ((thing.y - lv.bmaporgy) | 0) >> MAPBLOCKSHIFT;
    if (blockx >= 0 && blockx < lv.bmapwidth && blocky >= 0 && blocky < lv.bmapheight) {
      const idx = blocky * lv.bmapwidth + blockx;
      const link = lv.blocklinks[idx];
      thing.bprev = null;
      thing.bnext = link;
      if (link) link.bprev = thing;
      lv.blocklinks[idx] = thing;
    } else {
      thing.bnext = thing.bprev = null;
    }
  }
}

export function P_BlockLinesIterator(x: number, y: number, func: (ld: Line) => boolean): boolean {
  if (x < 0 || y < 0 || x >= lv.bmapwidth || y >= lv.bmapheight) return true;
  const bm = lv.blockmaplump;
  // Offsets are stored as shorts; read unsigned so large (but valid) maps work.
  let list = bm[lv.blockmap + y * lv.bmapwidth + x] & 0xffff;
  const vc = g.validcount;
  for (; bm[list] !== -1 && list < bm.length; list++) {
    const ld = lv.lines[bm[list]];
    if (!ld || ld.validcount === vc) continue;
    ld.validcount = vc;
    if (!func(ld)) return false;
  }
  return true;
}

export function P_BlockThingsIterator(x: number, y: number, func: (mo: Mobj) => boolean): boolean {
  if (x < 0 || y < 0 || x >= lv.bmapwidth || y >= lv.bmapheight) return true;
  for (let mobj = lv.blocklinks[y * lv.bmapwidth + x]; mobj; mobj = mobj.bnext) {
    if (!func(mobj)) return false;
  }
  return true;
}

// ---- intercepts
const intercepts: Intercept[] = [];
let intercept_p = 0;
export const trace: DivLine = { x: 0, y: 0, dx: 0, dy: 0 };
let earlyout = false;

function addIntercept(frac: number, line: Line | null, thing: Mobj | null): void {
  if (intercept_p === intercepts.length) intercepts.push({ frac: 0, isaline: false, line: null, thing: null });
  const ic = intercepts[intercept_p++];
  ic.frac = frac;
  ic.isaline = line !== null;
  ic.line = line;
  ic.thing = thing;
}

const tmpdl: DivLine = { x: 0, y: 0, dx: 0, dy: 0 };

function PIT_AddLineIntercepts(ld: Line): boolean {
  let s1: number, s2: number;
  if (trace.dx > FRACUNIT * 16 || trace.dy > FRACUNIT * 16 || trace.dx < -FRACUNIT * 16 || trace.dy < -FRACUNIT * 16) {
    s1 = P_PointOnDivlineSide(ld.v1.x, ld.v1.y, trace);
    s2 = P_PointOnDivlineSide(ld.v2.x, ld.v2.y, trace);
  } else {
    s1 = P_PointOnLineSide(trace.x, trace.y, ld);
    s2 = P_PointOnLineSide((trace.x + trace.dx) | 0, (trace.y + trace.dy) | 0, ld);
  }
  if (s1 === s2) return true;
  P_MakeDivline(ld, tmpdl);
  const frac = P_InterceptVector(trace, tmpdl);
  if (frac < 0) return true;
  if (earlyout && frac < FRACUNIT && !ld.backsector) return false;
  addIntercept(frac, ld, null);
  return true;
}

function PIT_AddThingIntercepts(thing: Mobj): boolean {
  const tracepositive = (trace.dx ^ trace.dy) > 0;
  let x1: number, y1: number, x2: number, y2: number;
  if (tracepositive) {
    x1 = (thing.x - thing.radius) | 0;
    y1 = (thing.y + thing.radius) | 0;
    x2 = (thing.x + thing.radius) | 0;
    y2 = (thing.y - thing.radius) | 0;
  } else {
    x1 = (thing.x - thing.radius) | 0;
    y1 = (thing.y - thing.radius) | 0;
    x2 = (thing.x + thing.radius) | 0;
    y2 = (thing.y + thing.radius) | 0;
  }
  const s1 = P_PointOnDivlineSide(x1, y1, trace);
  const s2 = P_PointOnDivlineSide(x2, y2, trace);
  if (s1 === s2) return true;
  tmpdl.x = x1;
  tmpdl.y = y1;
  tmpdl.dx = (x2 - x1) | 0;
  tmpdl.dy = (y2 - y1) | 0;
  const frac = P_InterceptVector(trace, tmpdl);
  if (frac < 0) return true;
  addIntercept(frac, null, thing);
  return true;
}

function P_TraverseIntercepts(func: Traverser, maxfrac: number): boolean {
  let count = intercept_p;
  let inter: Intercept | null = null;
  while (count--) {
    let dist = MAXINT;
    for (let i = 0; i < intercept_p; i++) {
      const scan = intercepts[i];
      if (scan.frac < dist) {
        dist = scan.frac;
        inter = scan;
      }
    }
    if (dist > maxfrac) return true;
    if (!func(inter!)) return false;
    inter!.frac = MAXINT;
  }
  return true;
}

export function P_PathTraverse(x1: number, y1: number, x2: number, y2: number, flags: number, trav: Traverser): boolean {
  earlyout = !!(flags & PT_EARLYOUT);
  g.validcount++;
  intercept_p = 0;
  if ((((x1 - lv.bmaporgx) | 0) & (MAPBLOCKSIZE - 1)) === 0) x1 = (x1 + FRACUNIT) | 0;
  if ((((y1 - lv.bmaporgy) | 0) & (MAPBLOCKSIZE - 1)) === 0) y1 = (y1 + FRACUNIT) | 0;
  trace.x = x1;
  trace.y = y1;
  trace.dx = (x2 - x1) | 0;
  trace.dy = (y2 - y1) | 0;
  x1 = (x1 - lv.bmaporgx) | 0;
  y1 = (y1 - lv.bmaporgy) | 0;
  const xt1 = x1 >> MAPBLOCKSHIFT;
  const yt1 = y1 >> MAPBLOCKSHIFT;
  x2 = (x2 - lv.bmaporgx) | 0;
  y2 = (y2 - lv.bmaporgy) | 0;
  const xt2 = x2 >> MAPBLOCKSHIFT;
  const yt2 = y2 >> MAPBLOCKSHIFT;
  let mapxstep: number, mapystep: number, partial: number, xstep: number, ystep: number;
  if (xt2 > xt1) {
    mapxstep = 1;
    partial = FRACUNIT - ((x1 >> MAPBTOFRAC) & (FRACUNIT - 1));
    ystep = FixedDiv((y2 - y1) | 0, Math.abs((x2 - x1) | 0) | 0);
  } else if (xt2 < xt1) {
    mapxstep = -1;
    partial = (x1 >> MAPBTOFRAC) & (FRACUNIT - 1);
    ystep = FixedDiv((y2 - y1) | 0, Math.abs((x2 - x1) | 0) | 0);
  } else {
    mapxstep = 0;
    partial = FRACUNIT;
    ystep = 256 * FRACUNIT;
  }
  let yintercept = ((y1 >> MAPBTOFRAC) + FixedMul(partial, ystep)) | 0;
  if (yt2 > yt1) {
    mapystep = 1;
    partial = FRACUNIT - ((y1 >> MAPBTOFRAC) & (FRACUNIT - 1));
    xstep = FixedDiv((x2 - x1) | 0, Math.abs((y2 - y1) | 0) | 0);
  } else if (yt2 < yt1) {
    mapystep = -1;
    partial = (y1 >> MAPBTOFRAC) & (FRACUNIT - 1);
    xstep = FixedDiv((x2 - x1) | 0, Math.abs((y2 - y1) | 0) | 0);
  } else {
    mapystep = 0;
    partial = FRACUNIT;
    xstep = 256 * FRACUNIT;
  }
  let xintercept = ((x1 >> MAPBTOFRAC) + FixedMul(partial, xstep)) | 0;
  let mapx = xt1;
  let mapy = yt1;
  for (let count = 0; count < 64; count++) {
    if (flags & PT_ADDLINES) if (!P_BlockLinesIterator(mapx, mapy, PIT_AddLineIntercepts)) return false;
    if (flags & PT_ADDTHINGS) if (!P_BlockThingsIterator(mapx, mapy, PIT_AddThingIntercepts)) return false;
    if (mapx === xt2 && mapy === yt2) break;
    if (yintercept >> FRACBITS === mapy) {
      yintercept = (yintercept + ystep) | 0;
      mapx += mapxstep;
    } else if (xintercept >> FRACBITS === mapx) {
      xintercept = (xintercept + xstep) | 0;
      mapy += mapystep;
    }
  }
  return P_TraverseIntercepts(trav, FRACUNIT);
}

// p_map.c — movement, collision detection, hitscan and radius attacks.
import { FRACBITS, FRACUNIT, FixedMul, FixedDiv } from '../core/fixed';
import { finesine, finecosine, ANG180, ANGLETOFINESHIFT } from '../core/tables';
import { P_Random } from '../core/random';
import {
  MF_SHOOTABLE, MF_MISSILE, MF_SKULLFLY, MF_SOLID, MF_SPECIAL, MF_PICKUP, MF_NOCLIP, MF_TELEPORT, MF_DROPOFF,
  MF_FLOAT, MF_NOBLOOD, MF_DROPPED, ML_BLOCKING, ML_BLOCKMONSTERS, ML_TWOSIDED, MAXRADIUS, MAPBLOCKSHIFT,
  PT_ADDLINES, PT_ADDTHINGS, USERANGE, SlopeType, BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT,
  type Mobj, type Line, type Sector, type Player,
} from '../doom/defs';
import { S, MT } from '../doom/info';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import {
  P_BlockThingsIterator, P_BlockLinesIterator, P_BoxOnLineSide, P_LineOpening, P_PointOnLineSide, P_AproxDistance,
  P_PathTraverse, P_SetThingPosition, P_UnsetThingPosition, opening, trace, type Intercept,
} from './p_maputl';
import { P_SetMobjState, P_SpawnPuff, P_SpawnBlood, P_RemoveMobj, P_SpawnMobj } from './p_mobj';
import { P_DamageMobj, P_TouchSpecialThing } from './p_inter';
import { P_CrossSpecialLine, P_ShootSpecialLine } from './p_spec';
import { P_UseSpecialLine } from './p_switch';
import { P_CheckSight } from './p_sight';
import { R_PointInSubsector, R_PointToAngle2 } from '../render/renderer';
import { S_StartSound } from '../sound/s_sound';

/** Globals shared by the movement / attack code (and p_sight's slopes, as in vanilla). */
export const mapState = {
  tmthing: null as unknown as Mobj,
  tmflags: 0,
  tmx: 0,
  tmy: 0,
  floatok: false,
  tmfloorz: 0,
  tmceilingz: 0,
  tmdropoffz: 0,
  ceilingline: null as Line | null,
  linetarget: null as Mobj | null,
  attackrange: 0,
  aimslope: 0,
  topslope: 0,
  bottomslope: 0,
};

const tmbbox = [0, 0, 0, 0];
const spechit: Line[] = [];
let numspechit = 0;

const spechitView = {
  get count(): number { return numspechit; },
  lines: spechit,
  clear(): void { numspechit = 0; },
};
/** Special lines crossed by the last P_CheckPosition (used by monster door opening in P_Move). */
export function getSpechits(): typeof spechitView {
  return spechitView;
}

function PIT_StompThing(thing: Mobj): boolean {
  const ms = mapState;
  if (!(thing.flags & MF_SHOOTABLE)) return true;
  const blockdist = (thing.radius + ms.tmthing.radius) | 0;
  if (Math.abs((thing.x - ms.tmx) | 0) >= blockdist || Math.abs((thing.y - ms.tmy) | 0) >= blockdist) return true;
  if (thing === ms.tmthing) return true;
  if (!ms.tmthing.player && g.gamemap !== 30) return false;
  P_DamageMobj(thing, ms.tmthing, ms.tmthing, 10000);
  return true;
}

function setupTm(thing: Mobj, x: number, y: number): void {
  const ms = mapState;
  ms.tmthing = thing;
  ms.tmflags = thing.flags;
  ms.tmx = x;
  ms.tmy = y;
  tmbbox[BOXTOP] = (y + thing.radius) | 0;
  tmbbox[BOXBOTTOM] = (y - thing.radius) | 0;
  tmbbox[BOXRIGHT] = (x + thing.radius) | 0;
  tmbbox[BOXLEFT] = (x - thing.radius) | 0;
  const newsubsec = R_PointInSubsector(x, y);
  ms.ceilingline = null;
  ms.tmfloorz = ms.tmdropoffz = newsubsec.sector.floorheight;
  ms.tmceilingz = newsubsec.sector.ceilingheight;
  g.validcount++;
  numspechit = 0;
}

export function P_TeleportMove(thing: Mobj, x: number, y: number): boolean {
  setupTm(thing, x, y);
  const xl = ((tmbbox[BOXLEFT] - lv.bmaporgx - MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  const xh = ((tmbbox[BOXRIGHT] - lv.bmaporgx + MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  const yl = ((tmbbox[BOXBOTTOM] - lv.bmaporgy - MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  const yh = ((tmbbox[BOXTOP] - lv.bmaporgy + MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  for (let bx = xl; bx <= xh; bx++) for (let by = yl; by <= yh; by++) if (!P_BlockThingsIterator(bx, by, PIT_StompThing)) return false;
  P_UnsetThingPosition(thing);
  thing.floorz = mapState.tmfloorz;
  thing.ceilingz = mapState.tmceilingz;
  thing.x = x;
  thing.y = y;
  P_SetThingPosition(thing);
  return true;
}

function PIT_CheckLine(ld: Line): boolean {
  const ms = mapState;
  if (tmbbox[BOXRIGHT] <= ld.bbox[BOXLEFT] || tmbbox[BOXLEFT] >= ld.bbox[BOXRIGHT] || tmbbox[BOXTOP] <= ld.bbox[BOXBOTTOM] || tmbbox[BOXBOTTOM] >= ld.bbox[BOXTOP]) return true;
  if (P_BoxOnLineSide(tmbbox, ld) !== -1) return true;
  if (!ld.backsector) return false;
  if (!(ms.tmthing.flags & MF_MISSILE)) {
    if (ld.flags & ML_BLOCKING) return false;
    if (!ms.tmthing.player && ld.flags & ML_BLOCKMONSTERS) return false;
  }
  P_LineOpening(ld);
  if (opening.opentop < ms.tmceilingz) {
    ms.tmceilingz = opening.opentop;
    ms.ceilingline = ld;
  }
  if (opening.openbottom > ms.tmfloorz) ms.tmfloorz = opening.openbottom;
  if (opening.lowfloor < ms.tmdropoffz) ms.tmdropoffz = opening.lowfloor;
  if (ld.special) spechit[numspechit++] = ld;
  return true;
}

function PIT_CheckThing(thing: Mobj): boolean {
  const ms = mapState;
  const tm = ms.tmthing;
  if (!(thing.flags & (MF_SOLID | MF_SPECIAL | MF_SHOOTABLE))) return true;
  const blockdist = (thing.radius + tm.radius) | 0;
  if (Math.abs((thing.x - ms.tmx) | 0) >= blockdist || Math.abs((thing.y - ms.tmy) | 0) >= blockdist) return true;
  if (thing === tm) return true;
  if (tm.flags & MF_SKULLFLY) {
    const damage = ((P_Random() % 8) + 1) * tm.info.damage;
    P_DamageMobj(thing, tm, tm, damage);
    tm.flags &= ~MF_SKULLFLY;
    tm.momx = tm.momy = tm.momz = 0;
    P_SetMobjState(tm, tm.info.spawnstate);
    return false;
  }
  if (tm.flags & MF_MISSILE) {
    if (tm.z > thing.z + thing.height) return true;
    if (tm.z + tm.height < thing.z) return true;
    if (tm.target && (tm.target.type === thing.type || (tm.target.type === MT.MT_KNIGHT && thing.type === MT.MT_BRUISER) || (tm.target.type === MT.MT_BRUISER && thing.type === MT.MT_KNIGHT))) {
      if (thing === tm.target) return true;
      if (thing.type !== MT.MT_PLAYER) return false;
    }
    if (!(thing.flags & MF_SHOOTABLE)) return !(thing.flags & MF_SOLID);
    const damage = ((P_Random() % 8) + 1) * tm.info.damage;
    P_DamageMobj(thing, tm, tm.target, damage);
    return false;
  }
  if (thing.flags & MF_SPECIAL) {
    const solid = thing.flags & MF_SOLID;
    if (ms.tmflags & MF_PICKUP) P_TouchSpecialThing(thing, tm);
    return !solid;
  }
  return !(thing.flags & MF_SOLID);
}

export function P_CheckPosition(thing: Mobj, x: number, y: number): boolean {
  setupTm(thing, x, y);
  if (mapState.tmflags & MF_NOCLIP) return true;
  let xl = ((tmbbox[BOXLEFT] - lv.bmaporgx - MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  let xh = ((tmbbox[BOXRIGHT] - lv.bmaporgx + MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  let yl = ((tmbbox[BOXBOTTOM] - lv.bmaporgy - MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  let yh = ((tmbbox[BOXTOP] - lv.bmaporgy + MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
  for (let bx = xl; bx <= xh; bx++) for (let by = yl; by <= yh; by++) if (!P_BlockThingsIterator(bx, by, PIT_CheckThing)) return false;
  xl = ((tmbbox[BOXLEFT] - lv.bmaporgx) | 0) >> MAPBLOCKSHIFT;
  xh = ((tmbbox[BOXRIGHT] - lv.bmaporgx) | 0) >> MAPBLOCKSHIFT;
  yl = ((tmbbox[BOXBOTTOM] - lv.bmaporgy) | 0) >> MAPBLOCKSHIFT;
  yh = ((tmbbox[BOXTOP] - lv.bmaporgy) | 0) >> MAPBLOCKSHIFT;
  for (let bx = xl; bx <= xh; bx++) for (let by = yl; by <= yh; by++) if (!P_BlockLinesIterator(bx, by, PIT_CheckLine)) return false;
  return true;
}

export function P_TryMove(thing: Mobj, x: number, y: number): boolean {
  const ms = mapState;
  ms.floatok = false;
  if (!P_CheckPosition(thing, x, y)) return false;
  if (!(thing.flags & MF_NOCLIP)) {
    if (ms.tmceilingz - ms.tmfloorz < thing.height) return false;
    ms.floatok = true;
    if (!(thing.flags & MF_TELEPORT) && ms.tmceilingz - thing.z < thing.height) return false;
    if (!(thing.flags & MF_TELEPORT) && ms.tmfloorz - thing.z > 24 * FRACUNIT) return false;
    if (!(thing.flags & (MF_DROPOFF | MF_FLOAT)) && ms.tmfloorz - ms.tmdropoffz > 24 * FRACUNIT) return false;
  }
  P_UnsetThingPosition(thing);
  const oldx = thing.x;
  const oldy = thing.y;
  thing.floorz = ms.tmfloorz;
  thing.ceilingz = ms.tmceilingz;
  thing.x = x;
  thing.y = y;
  P_SetThingPosition(thing);
  if (!(thing.flags & (MF_TELEPORT | MF_NOCLIP))) {
    while (numspechit--) {
      const ld = spechit[numspechit];
      const side = P_PointOnLineSide(thing.x, thing.y, ld);
      const oldside = P_PointOnLineSide(oldx, oldy, ld);
      if (side !== oldside && ld.special) P_CrossSpecialLine(ld.id, oldside, thing);
    }
  }
  return true;
}

function P_ThingHeightClip(thing: Mobj): boolean {
  const onfloor = thing.z === thing.floorz;
  P_CheckPosition(thing, thing.x, thing.y);
  thing.floorz = mapState.tmfloorz;
  thing.ceilingz = mapState.tmceilingz;
  if (onfloor) thing.z = thing.floorz;
  else if (thing.z + thing.height > thing.ceilingz) thing.z = (thing.ceilingz - thing.height) | 0;
  if (thing.ceilingz - thing.floorz < thing.height) return false;
  return true;
}

// ---- sliding
let bestslidefrac = 0;
let bestslideline: Line | null = null;
let slidemo: Mobj;
let tmxmove = 0;
let tmymove = 0;

function P_HitSlideLine(ld: Line): void {
  if (ld.slopetype === SlopeType.ST_HORIZONTAL) {
    tmymove = 0;
    return;
  }
  if (ld.slopetype === SlopeType.ST_VERTICAL) {
    tmxmove = 0;
    return;
  }
  const side = P_PointOnLineSide(slidemo.x, slidemo.y, ld);
  let lineangle = R_PointToAngle2(0, 0, ld.dx, ld.dy);
  if (side === 1) lineangle = (lineangle + ANG180) >>> 0;
  const moveangle = R_PointToAngle2(0, 0, tmxmove, tmymove);
  let deltaangle = (moveangle - lineangle) >>> 0;
  if (deltaangle > ANG180) deltaangle = (deltaangle + ANG180) >>> 0;
  lineangle >>>= ANGLETOFINESHIFT;
  deltaangle >>>= ANGLETOFINESHIFT;
  const movelen = P_AproxDistance(tmxmove, tmymove);
  const newlen = FixedMul(movelen, finecosine[deltaangle]);
  tmxmove = FixedMul(newlen, finecosine[lineangle]);
  tmymove = FixedMul(newlen, finesine[lineangle]);
}

function PTR_SlideTraverse(inter: Intercept): boolean {
  if (!inter.isaline) throw new Error('PTR_SlideTraverse: not a line?');
  const li = inter.line!;
  let blocking = false;
  if (!(li.flags & ML_TWOSIDED)) {
    if (P_PointOnLineSide(slidemo.x, slidemo.y, li)) return true;
    blocking = true;
  } else {
    P_LineOpening(li);
    if (opening.openrange < slidemo.height) blocking = true;
    else if (opening.opentop - slidemo.z < slidemo.height) blocking = true;
    else if (opening.openbottom - slidemo.z > 24 * FRACUNIT) blocking = true;
  }
  if (!blocking) return true;
  if (inter.frac < bestslidefrac) {
    bestslidefrac = inter.frac;
    bestslideline = li;
  }
  return false;
}

export function P_SlideMove(mo: Mobj): void {
  slidemo = mo;
  let hitcount = 0;
  const stairstep = () => {
    if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0)) P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y);
  };
  for (;;) {
    if (++hitcount === 3) {
      stairstep();
      return;
    }
    let leadx: number, leady: number, trailx: number, traily: number;
    if (mo.momx > 0) {
      leadx = (mo.x + mo.radius) | 0;
      trailx = (mo.x - mo.radius) | 0;
    } else {
      leadx = (mo.x - mo.radius) | 0;
      trailx = (mo.x + mo.radius) | 0;
    }
    if (mo.momy > 0) {
      leady = (mo.y + mo.radius) | 0;
      traily = (mo.y - mo.radius) | 0;
    } else {
      leady = (mo.y - mo.radius) | 0;
      traily = (mo.y + mo.radius) | 0;
    }
    bestslidefrac = FRACUNIT + 1;
    P_PathTraverse(leadx, leady, (leadx + mo.momx) | 0, (leady + mo.momy) | 0, PT_ADDLINES, PTR_SlideTraverse);
    P_PathTraverse(trailx, leady, (trailx + mo.momx) | 0, (leady + mo.momy) | 0, PT_ADDLINES, PTR_SlideTraverse);
    P_PathTraverse(leadx, traily, (leadx + mo.momx) | 0, (traily + mo.momy) | 0, PT_ADDLINES, PTR_SlideTraverse);
    if (bestslidefrac === FRACUNIT + 1) {
      stairstep();
      return;
    }
    bestslidefrac -= 0x800;
    if (bestslidefrac > 0) {
      const newx = FixedMul(mo.momx, bestslidefrac);
      const newy = FixedMul(mo.momy, bestslidefrac);
      if (!P_TryMove(mo, (mo.x + newx) | 0, (mo.y + newy) | 0)) {
        stairstep();
        return;
      }
    }
    bestslidefrac = FRACUNIT - (bestslidefrac + 0x800);
    if (bestslidefrac > FRACUNIT) bestslidefrac = FRACUNIT;
    if (bestslidefrac <= 0) return;
    tmxmove = FixedMul(mo.momx, bestslidefrac);
    tmymove = FixedMul(mo.momy, bestslidefrac);
    P_HitSlideLine(bestslideline!);
    mo.momx = tmxmove;
    mo.momy = tmymove;
    if (P_TryMove(mo, (mo.x + tmxmove) | 0, (mo.y + tmymove) | 0)) return;
  }
}

// ---- hitscan
let shootthing: Mobj;
let shootz = 0;
let la_damage = 0;

function PTR_AimTraverse(inter: Intercept): boolean {
  const ms = mapState;
  if (inter.isaline) {
    const li = inter.line!;
    if (!(li.flags & ML_TWOSIDED)) return false;
    P_LineOpening(li);
    if (opening.openbottom >= opening.opentop) return false;
    const dist = FixedMul(ms.attackrange, inter.frac);
    if (li.frontsector!.floorheight !== li.backsector!.floorheight) {
      const slope = FixedDiv((opening.openbottom - shootz) | 0, dist);
      if (slope > ms.bottomslope) ms.bottomslope = slope;
    }
    if (li.frontsector!.ceilingheight !== li.backsector!.ceilingheight) {
      const slope = FixedDiv((opening.opentop - shootz) | 0, dist);
      if (slope < ms.topslope) ms.topslope = slope;
    }
    if (ms.topslope <= ms.bottomslope) return false;
    return true;
  }
  const th = inter.thing!;
  if (th === shootthing) return true;
  if (!(th.flags & MF_SHOOTABLE)) return true;
  const dist = FixedMul(ms.attackrange, inter.frac);
  let thingtopslope = FixedDiv((th.z + th.height - shootz) | 0, dist);
  if (thingtopslope < ms.bottomslope) return true;
  let thingbottomslope = FixedDiv((th.z - shootz) | 0, dist);
  if (thingbottomslope > ms.topslope) return true;
  if (thingtopslope > ms.topslope) thingtopslope = ms.topslope;
  if (thingbottomslope < ms.bottomslope) thingbottomslope = ms.bottomslope;
  ms.aimslope = ((thingtopslope + thingbottomslope) / 2) | 0;
  ms.linetarget = th;
  return false;
}

function PTR_ShootTraverse(inter: Intercept): boolean {
  const ms = mapState;
  if (inter.isaline) {
    const li = inter.line!;
    if (li.special) P_ShootSpecialLine(shootthing, li);
    let hit = !(li.flags & ML_TWOSIDED);
    if (!hit) {
      P_LineOpening(li);
      const dist = FixedMul(ms.attackrange, inter.frac);
      if (li.frontsector!.floorheight !== li.backsector!.floorheight) {
        const slope = FixedDiv((opening.openbottom - shootz) | 0, dist);
        if (slope > ms.aimslope) hit = true;
      }
      if (!hit && li.frontsector!.ceilingheight !== li.backsector!.ceilingheight) {
        const slope = FixedDiv((opening.opentop - shootz) | 0, dist);
        if (slope < ms.aimslope) hit = true;
      }
      if (!hit) return true;
    }
    const frac = (inter.frac - FixedDiv(4 * FRACUNIT, ms.attackrange)) | 0;
    const x = (trace.x + FixedMul(trace.dx, frac)) | 0;
    const y = (trace.y + FixedMul(trace.dy, frac)) | 0;
    const z = (shootz + FixedMul(ms.aimslope, FixedMul(frac, ms.attackrange))) | 0;
    if (li.frontsector!.ceilingpic === g.skyflatnum) {
      if (z > li.frontsector!.ceilingheight) return false;
      if (li.backsector && li.backsector.ceilingpic === g.skyflatnum) return false;
    }
    P_SpawnPuff(x, y, z);
    return false;
  }
  const th = inter.thing!;
  if (th === shootthing) return true;
  if (!(th.flags & MF_SHOOTABLE)) return true;
  const dist = FixedMul(ms.attackrange, inter.frac);
  const thingtopslope = FixedDiv((th.z + th.height - shootz) | 0, dist);
  if (thingtopslope < ms.aimslope) return true;
  const thingbottomslope = FixedDiv((th.z - shootz) | 0, dist);
  if (thingbottomslope > ms.aimslope) return true;
  const frac = (inter.frac - FixedDiv(10 * FRACUNIT, ms.attackrange)) | 0;
  const x = (trace.x + FixedMul(trace.dx, frac)) | 0;
  const y = (trace.y + FixedMul(trace.dy, frac)) | 0;
  const z = (shootz + FixedMul(ms.aimslope, FixedMul(frac, ms.attackrange))) | 0;
  if (th.flags & MF_NOBLOOD) P_SpawnPuff(x, y, z);
  else P_SpawnBlood(x, y, z, la_damage);
  if (la_damage) P_DamageMobj(th, shootthing, shootthing, la_damage);
  return false;
}

export function P_AimLineAttack(t1: Mobj, angle: number, distance: number): number {
  const ms = mapState;
  angle >>>= ANGLETOFINESHIFT;
  shootthing = t1;
  const x2 = (t1.x + Math.imul(distance >> FRACBITS, finecosine[angle])) | 0;
  const y2 = (t1.y + Math.imul(distance >> FRACBITS, finesine[angle])) | 0;
  shootz = (t1.z + (t1.height >> 1) + 8 * FRACUNIT) | 0;
  ms.topslope = ((100 * FRACUNIT) / 160) | 0;
  ms.bottomslope = ((-100 * FRACUNIT) / 160) | 0;
  ms.attackrange = distance;
  ms.linetarget = null;
  P_PathTraverse(t1.x, t1.y, x2, y2, PT_ADDLINES | PT_ADDTHINGS, PTR_AimTraverse);
  if (ms.linetarget) return ms.aimslope;
  return 0;
}

export function P_LineAttack(t1: Mobj, angle: number, distance: number, slope: number, damage: number): void {
  const ms = mapState;
  angle >>>= ANGLETOFINESHIFT;
  shootthing = t1;
  la_damage = damage;
  const x2 = (t1.x + Math.imul(distance >> FRACBITS, finecosine[angle])) | 0;
  const y2 = (t1.y + Math.imul(distance >> FRACBITS, finesine[angle])) | 0;
  shootz = (t1.z + (t1.height >> 1) + 8 * FRACUNIT) | 0;
  ms.attackrange = distance;
  ms.aimslope = slope;
  P_PathTraverse(t1.x, t1.y, x2, y2, PT_ADDLINES | PT_ADDTHINGS, PTR_ShootTraverse);
}

// ---- use
let usething: Mobj;

function PTR_UseTraverse(inter: Intercept): boolean {
  const line = inter.line!;
  if (!line.special) {
    P_LineOpening(line);
    if (opening.openrange <= 0) {
      S_StartSound(usething, SFX.sfx_noway);
      return false;
    }
    return true;
  }
  const side = P_PointOnLineSide(usething.x, usething.y, line) === 1 ? 1 : 0;
  P_UseSpecialLine(usething, line, side);
  return false;
}

export function P_UseLines(player: Player): void {
  usething = player.mo!;
  const angle = player.mo!.angle >>> ANGLETOFINESHIFT;
  const x1 = player.mo!.x;
  const y1 = player.mo!.y;
  const x2 = (x1 + Math.imul(USERANGE >> FRACBITS, finecosine[angle])) | 0;
  const y2 = (y1 + Math.imul(USERANGE >> FRACBITS, finesine[angle])) | 0;
  P_PathTraverse(x1, y1, x2, y2, PT_ADDLINES, PTR_UseTraverse);
}

// ---- radius attack
let bombsource: Mobj | null = null;
let bombspot: Mobj;
let bombdamage = 0;

function PIT_RadiusAttack(thing: Mobj): boolean {
  if (!(thing.flags & MF_SHOOTABLE)) return true;
  if (thing.type === MT.MT_CYBORG || thing.type === MT.MT_SPIDER) return true;
  const dx = Math.abs((thing.x - bombspot.x) | 0) | 0;
  const dy = Math.abs((thing.y - bombspot.y) | 0) | 0;
  let dist = dx > dy ? dx : dy;
  dist = ((dist - thing.radius) | 0) >> FRACBITS;
  if (dist < 0) dist = 0;
  if (dist >= bombdamage) return true;
  if (P_CheckSight(thing, bombspot)) P_DamageMobj(thing, bombspot, bombsource, bombdamage - dist);
  return true;
}

export function P_RadiusAttack(spot: Mobj, source: Mobj | null, damage: number): void {
  const dist = (damage + MAXRADIUS) << FRACBITS; // MAXRADIUS is already fixed point; vanilla quirk kept
  const yh = ((spot.y + dist - lv.bmaporgy) | 0) >> MAPBLOCKSHIFT;
  const yl = ((spot.y - dist - lv.bmaporgy) | 0) >> MAPBLOCKSHIFT;
  const xh = ((spot.x + dist - lv.bmaporgx) | 0) >> MAPBLOCKSHIFT;
  const xl = ((spot.x - dist - lv.bmaporgx) | 0) >> MAPBLOCKSHIFT;
  bombspot = spot;
  bombsource = source;
  bombdamage = damage;
  for (let y = yl; y <= yh; y++) for (let x = xl; x <= xh; x++) P_BlockThingsIterator(x, y, PIT_RadiusAttack);
}

// ---- sector height changes
let crushchange = false;
let nofit = false;

function PIT_ChangeSector(thing: Mobj): boolean {
  if (P_ThingHeightClip(thing)) return true;
  if (thing.health <= 0) {
    P_SetMobjState(thing, S.S_GIBS);
    thing.flags &= ~MF_SOLID;
    thing.height = 0;
    thing.radius = 0;
    return true;
  }
  if (thing.flags & MF_DROPPED) {
    P_RemoveMobj(thing);
    return true;
  }
  if (!(thing.flags & MF_SHOOTABLE)) return true;
  nofit = true;
  if (crushchange && !(g.leveltime & 3)) {
    P_DamageMobj(thing, null, null, 10);
    const mo = P_SpawnMobj(thing.x, thing.y, (thing.z + ((thing.height / 2) | 0)) | 0, MT.MT_BLOOD);
    mo.momx = (P_Random() - P_Random()) << 12;
    mo.momy = (P_Random() - P_Random()) << 12;
  }
  return true;
}

export function P_ChangeSector(sector: Sector, crunch: boolean): boolean {
  nofit = false;
  crushchange = crunch;
  for (let x = sector.blockbox[BOXLEFT]; x <= sector.blockbox[BOXRIGHT]; x++) {
    for (let y = sector.blockbox[BOXBOTTOM]; y <= sector.blockbox[BOXTOP]; y++) P_BlockThingsIterator(x, y, PIT_ChangeSector);
  }
  return nofit;
}

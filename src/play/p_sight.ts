// p_sight.c — line of sight checking through the BSP tree, using the REJECT table.
import { FRACBITS, FixedMul, FixedDiv } from '../core/fixed';
import { NF_SUBSECTOR, ML_TWOSIDED, type Mobj, type Node } from '../doom/defs';
import { g } from '../doom/state';
import { lv } from './p_setup';
import { mapState } from './p_map';
import type { DivLine } from './p_maputl';

let sightzstart = 0;
const strace: DivLine = { x: 0, y: 0, dx: 0, dy: 0 };
let t2x = 0;
let t2y = 0;

function P_DivlineSide(x: number, y: number, node: DivLine | Node): number {
  if (!node.dx) {
    if (x === node.x) return 2;
    if (x <= node.x) return node.dy > 0 ? 1 : 0;
    return node.dy < 0 ? 1 : 0;
  }
  if (!node.dy) {
    if (x === node.y) return 2; // vanilla compares x here (sic)
    if (y <= node.y) return node.dx < 0 ? 1 : 0;
    return node.dx > 0 ? 1 : 0;
  }
  const dx = (x - node.x) | 0;
  const dy = (y - node.y) | 0;
  const left = Math.imul(node.dy >> FRACBITS, dx >> FRACBITS);
  const right = Math.imul(dy >> FRACBITS, node.dx >> FRACBITS);
  if (right < left) return 0;
  if (left === right) return 2;
  return 1;
}

function P_InterceptVector2(v2: DivLine, v1: DivLine): number {
  const den = (FixedMul(v1.dy >> 8, v2.dx) - FixedMul(v1.dx >> 8, v2.dy)) | 0;
  if (den === 0) return 0;
  const num = (FixedMul(((v1.x - v2.x) | 0) >> 8, v1.dy) + FixedMul(((v2.y - v1.y) | 0) >> 8, v1.dx)) | 0;
  return FixedDiv(num, den);
}

const divl: DivLine = { x: 0, y: 0, dx: 0, dy: 0 };

function P_CrossSubsector(num: number): boolean {
  const ms = mapState;
  const sub = lv.subsectors[num];
  const vc = g.validcount;
  for (let i = 0; i < sub.numlines; i++) {
    const seg = lv.segs[sub.firstline + i];
    const line = seg.linedef;
    if (line.validcount === vc) continue;
    line.validcount = vc;
    const v1 = line.v1;
    const v2 = line.v2;
    let s1 = P_DivlineSide(v1.x, v1.y, strace);
    let s2 = P_DivlineSide(v2.x, v2.y, strace);
    if (s1 === s2) continue;
    divl.x = v1.x;
    divl.y = v1.y;
    divl.dx = (v2.x - v1.x) | 0;
    divl.dy = (v2.y - v1.y) | 0;
    s1 = P_DivlineSide(strace.x, strace.y, divl);
    s2 = P_DivlineSide(t2x, t2y, divl);
    if (s1 === s2) continue;
    if (!(line.flags & ML_TWOSIDED)) return false;
    const front = seg.frontsector;
    const back = seg.backsector!;
    if (front.floorheight === back.floorheight && front.ceilingheight === back.ceilingheight) continue;
    const opentop = front.ceilingheight < back.ceilingheight ? front.ceilingheight : back.ceilingheight;
    const openbottom = front.floorheight > back.floorheight ? front.floorheight : back.floorheight;
    if (openbottom >= opentop) return false;
    const frac = P_InterceptVector2(strace, divl);
    if (front.floorheight !== back.floorheight) {
      const slope = FixedDiv((openbottom - sightzstart) | 0, frac);
      if (slope > ms.bottomslope) ms.bottomslope = slope;
    }
    if (front.ceilingheight !== back.ceilingheight) {
      const slope = FixedDiv((opentop - sightzstart) | 0, frac);
      if (slope < ms.topslope) ms.topslope = slope;
    }
    if (ms.topslope <= ms.bottomslope) return false;
  }
  return true;
}

function P_CrossBSPNode(bspnum: number): boolean {
  if (bspnum & NF_SUBSECTOR) {
    if (bspnum === -1) return P_CrossSubsector(0);
    return P_CrossSubsector(bspnum & ~NF_SUBSECTOR);
  }
  const bsp = lv.nodes[bspnum];
  let side = P_DivlineSide(strace.x, strace.y, bsp);
  if (side === 2) side = 0;
  if (!P_CrossBSPNode(bsp.children[side])) return false;
  if (side === P_DivlineSide(t2x, t2y, bsp)) return true;
  return P_CrossBSPNode(bsp.children[side ^ 1]);
}

export function P_CheckSight(t1: Mobj, t2: Mobj): boolean {
  const ms = mapState;
  const s1 = t1.subsector.sector.id;
  const s2 = t2.subsector.sector.id;
  const pnum = s1 * lv.sectors.length + s2;
  const bytenum = pnum >> 3;
  const bitnum = 1 << (pnum & 7);
  if (lv.rejectmatrix[bytenum] & bitnum) return false;
  g.validcount++;
  sightzstart = (t1.z + t1.height - (t1.height >> 2)) | 0;
  ms.topslope = (t2.z + t2.height - sightzstart) | 0;
  ms.bottomslope = (t2.z - sightzstart) | 0;
  strace.x = t1.x;
  strace.y = t1.y;
  t2x = t2.x;
  t2y = t2.y;
  strace.dx = (t2.x - t1.x) | 0;
  strace.dy = (t2.y - t1.y) | 0;
  return P_CrossBSPNode(lv.nodes.length - 1);
}

// p_enemy.c — monster AI and monster action functions.
import { FRACUNIT, FixedMul } from '../core/fixed';
import { finesine, finecosine, ANG90, ANG180, ANG270, ANGLETOFINESHIFT } from '../core/tables';
import { P_Random } from '../core/random';
import {
  Line, Mobj, ML_TWOSIDED, ML_SOUNDBLOCK, MF_SHOOTABLE, MF_JUSTHIT, MF_FLOAT, MF_INFLOAT, MF_AMBUSH, MF_JUSTATTACKED,
  MF_SHADOW, MF_CORPSE, MF_SKULLFLY, MF_SOLID, MELEERANGE, MISSILERANGE, FLOATSPEED, MAXRADIUS, MAPBLOCKSHIFT,
  MAXPLAYERS, Skill, GameMode, DoorType, FloorType, type Sector,
} from '../doom/defs';
import { S, MT, mobjinfo, registerActions } from '../doom/info';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { thinkercap } from './p_tick';
import { P_LineOpening, opening, P_AproxDistance, P_BlockThingsIterator, P_SetThingPosition, P_UnsetThingPosition } from './p_maputl';
import { P_TryMove, P_CheckPosition, P_AimLineAttack, P_LineAttack, P_RadiusAttack, P_TeleportMove, mapState, getSpechits } from './p_map';
import { P_CheckSight } from './p_sight';
import { P_SetMobjState, P_SpawnMissile, P_SpawnMobj, P_SpawnPuff, P_RemoveMobj, P_MobjThinker } from './p_mobj';
import { P_DamageMobj } from './p_inter';
import { P_UseSpecialLine } from './p_switch';
import { EV_DoDoor } from './p_doors';
import { EV_DoFloor } from './p_floor';
import { R_PointToAngle2 } from '../render/renderer';
import { S_StartSound } from '../sound/s_sound';
import { G_ExitLevel } from '../game/g_game';

const enum Dir { DI_EAST, DI_NORTHEAST, DI_NORTH, DI_NORTHWEST, DI_WEST, DI_SOUTHWEST, DI_SOUTH, DI_SOUTHEAST, DI_NODIR }
const opposite = [Dir.DI_WEST, Dir.DI_SOUTHWEST, Dir.DI_SOUTH, Dir.DI_SOUTHEAST, Dir.DI_EAST, Dir.DI_NORTHEAST, Dir.DI_NORTH, Dir.DI_NORTHWEST, Dir.DI_NODIR];
const diags = [Dir.DI_NORTHWEST, Dir.DI_NORTHEAST, Dir.DI_SOUTHWEST, Dir.DI_SOUTHEAST];

let soundtarget: Mobj | null = null;

function P_RecursiveSound(sec: Sector, soundblocks: number): void {
  if (sec.validcount === g.validcount && sec.soundtraversed <= soundblocks + 1) return;
  sec.validcount = g.validcount;
  sec.soundtraversed = soundblocks + 1;
  sec.soundtarget = soundtarget;
  for (let i = 0; i < sec.linecount; i++) {
    const check = sec.lines[i];
    if (!(check.flags & ML_TWOSIDED)) continue;
    P_LineOpening(check);
    if (opening.openrange <= 0) continue;
    const other = lv.sides[check.sidenum[0]].sector === sec ? lv.sides[check.sidenum[1]].sector : lv.sides[check.sidenum[0]].sector;
    if (check.flags & ML_SOUNDBLOCK) {
      if (!soundblocks) P_RecursiveSound(other, 1);
    } else P_RecursiveSound(other, soundblocks);
  }
}

export function P_NoiseAlert(target: Mobj, emmiter: Mobj): void {
  soundtarget = target;
  g.validcount++;
  P_RecursiveSound(emmiter.subsector.sector, 0);
}

function P_CheckMeleeRange(actor: Mobj): boolean {
  if (!actor.target) return false;
  const pl = actor.target;
  const dist = P_AproxDistance(pl.x - actor.x, pl.y - actor.y);
  if (dist >= MELEERANGE - 20 * FRACUNIT + pl.info.radius) return false;
  if (!P_CheckSight(actor, actor.target)) return false;
  return true;
}

function P_CheckMissileRange(actor: Mobj): boolean {
  if (!P_CheckSight(actor, actor.target!)) return false;
  if (actor.flags & MF_JUSTHIT) {
    actor.flags &= ~MF_JUSTHIT;
    return true;
  }
  if (actor.reactiontime) return false;
  let dist = (P_AproxDistance(actor.x - actor.target!.x, actor.y - actor.target!.y) - 64 * FRACUNIT) | 0;
  if (!actor.info.meleestate) dist = (dist - 128 * FRACUNIT) | 0;
  dist >>= 16;
  if (actor.type === MT.MT_VILE && dist > 14 * 64) return false;
  if (actor.type === MT.MT_UNDEAD) {
    if (dist < 196) return false;
    dist >>= 1;
  }
  if (actor.type === MT.MT_CYBORG || actor.type === MT.MT_SPIDER || actor.type === MT.MT_SKULL) dist >>= 1;
  if (dist > 200) dist = 200;
  if (actor.type === MT.MT_CYBORG && dist > 160) dist = 160;
  if (P_Random() < dist) return false;
  return true;
}

const xspeed = [FRACUNIT, 47000, 0, -47000, -FRACUNIT, -47000, 0, 47000];
const yspeed = [0, 47000, FRACUNIT, 47000, 0, -47000, -FRACUNIT, -47000];

function P_Move(actor: Mobj): boolean {
  if (actor.movedir === Dir.DI_NODIR) return false;
  if (actor.movedir >>> 0 >= 8) throw new Error('Weird actor->movedir!');
  const tryx = (actor.x + Math.imul(actor.info.speed, xspeed[actor.movedir])) | 0;
  const tryy = (actor.y + Math.imul(actor.info.speed, yspeed[actor.movedir])) | 0;
  const try_ok = P_TryMove(actor, tryx, tryy);
  if (!try_ok) {
    if (actor.flags & MF_FLOAT && mapState.floatok) {
      if (actor.z < mapState.tmfloorz) actor.z = (actor.z + FLOATSPEED) | 0;
      else actor.z = (actor.z - FLOATSPEED) | 0;
      actor.flags |= MF_INFLOAT;
      return true;
    }
    const sh = getSpechits();
    if (!sh.count) return false;
    actor.movedir = Dir.DI_NODIR;
    let good = false;
    for (let n = sh.count - 1; n >= 0; n--) {
      if (P_UseSpecialLine(actor, sh.lines[n], 0)) good = true;
    }
    sh.clear();
    return good;
  }
  actor.flags &= ~MF_INFLOAT;
  if (!(actor.flags & MF_FLOAT)) actor.z = actor.floorz;
  return true;
}

function P_TryWalk(actor: Mobj): boolean {
  if (!P_Move(actor)) return false;
  actor.movecount = P_Random() & 15;
  return true;
}

function P_NewChaseDir(actor: Mobj): void {
  if (!actor.target) throw new Error('P_NewChaseDir: called with no target');
  const olddir = actor.movedir;
  const turnaround = opposite[olddir];
  const deltax = (actor.target.x - actor.x) | 0;
  const deltay = (actor.target.y - actor.y) | 0;
  const d = [0, 0, 0];
  if (deltax > 10 * FRACUNIT) d[1] = Dir.DI_EAST;
  else if (deltax < -10 * FRACUNIT) d[1] = Dir.DI_WEST;
  else d[1] = Dir.DI_NODIR;
  if (deltay < -10 * FRACUNIT) d[2] = Dir.DI_SOUTH;
  else if (deltay > 10 * FRACUNIT) d[2] = Dir.DI_NORTH;
  else d[2] = Dir.DI_NODIR;
  if (d[1] !== Dir.DI_NODIR && d[2] !== Dir.DI_NODIR) {
    actor.movedir = diags[((deltay < 0 ? 1 : 0) << 1) + (deltax > 0 ? 1 : 0)];
    if (actor.movedir !== turnaround && P_TryWalk(actor)) return;
  }
  if (P_Random() > 200 || Math.abs(deltay) > Math.abs(deltax)) {
    const tdir = d[1];
    d[1] = d[2];
    d[2] = tdir;
  }
  if (d[1] === turnaround) d[1] = Dir.DI_NODIR;
  if (d[2] === turnaround) d[2] = Dir.DI_NODIR;
  if (d[1] !== Dir.DI_NODIR) {
    actor.movedir = d[1];
    if (P_TryWalk(actor)) return;
  }
  if (d[2] !== Dir.DI_NODIR) {
    actor.movedir = d[2];
    if (P_TryWalk(actor)) return;
  }
  if (olddir !== Dir.DI_NODIR) {
    actor.movedir = olddir;
    if (P_TryWalk(actor)) return;
  }
  if (P_Random() & 1) {
    for (let tdir = Dir.DI_EAST; tdir <= Dir.DI_SOUTHEAST; tdir++) {
      if (tdir !== turnaround) {
        actor.movedir = tdir;
        if (P_TryWalk(actor)) return;
      }
    }
  } else {
    for (let tdir = Dir.DI_SOUTHEAST; tdir !== Dir.DI_EAST - 1; tdir--) {
      if (tdir !== turnaround) {
        actor.movedir = tdir;
        if (P_TryWalk(actor)) return;
      }
    }
  }
  if (turnaround !== Dir.DI_NODIR) {
    actor.movedir = turnaround;
    if (P_TryWalk(actor)) return;
  }
  actor.movedir = Dir.DI_NODIR;
}

export function P_LookForPlayers(actor: Mobj, allaround: boolean): boolean {
  let c = 0;
  const stop = (actor.lastlook - 1) & 3;
  for (; ; actor.lastlook = (actor.lastlook + 1) & 3) {
    if (!g.playeringame[actor.lastlook]) continue;
    if (c++ === 2 || actor.lastlook === stop) return false;
    const player = g.players[actor.lastlook];
    if (player.health <= 0) continue;
    if (!P_CheckSight(actor, player.mo!)) continue;
    if (!allaround) {
      const an = (R_PointToAngle2(actor.x, actor.y, player.mo!.x, player.mo!.y) - actor.angle) >>> 0;
      if (an > ANG90 && an < ANG270) {
        const dist = P_AproxDistance(player.mo!.x - actor.x, player.mo!.y - actor.y);
        if (dist > MELEERANGE) continue;
      }
    }
    actor.target = player.mo;
    return true;
  }
}

function forEachMobj(fn: (mo: Mobj) => boolean | void): void {
  for (let th = thinkercap.next; th !== thinkercap; th = th.next) {
    if (th.func !== P_MobjThinker) continue;
    if (fn(th as Mobj) === false) return;
  }
}

function junkLine(tag: number): Line {
  const l = new Line();
  l.tag = tag;
  return l;
}

function A_KeenDie(mo: Mobj): void {
  A_Fall(mo);
  let alive = false;
  forEachMobj((mo2) => {
    if (mo2 !== mo && mo2.type === mo.type && mo2.health > 0) {
      alive = true;
      return false;
    }
  });
  if (alive) return;
  EV_DoDoor(junkLine(666), DoorType.open);
}

function A_Look(actor: Mobj): void {
  actor.threshold = 0;
  const targ = actor.subsector.sector.soundtarget;
  let seen = false;
  if (targ && targ.flags & MF_SHOOTABLE) {
    actor.target = targ;
    if (actor.flags & MF_AMBUSH) {
      if (P_CheckSight(actor, actor.target)) seen = true;
    } else seen = true;
  }
  if (!seen && !P_LookForPlayers(actor, false)) return;
  if (actor.info.seesound) {
    let sound: number;
    switch (actor.info.seesound) {
      case SFX.sfx_posit1:
      case SFX.sfx_posit2:
      case SFX.sfx_posit3:
        sound = SFX.sfx_posit1 + (P_Random() % 3);
        break;
      case SFX.sfx_bgsit1:
      case SFX.sfx_bgsit2:
        sound = SFX.sfx_bgsit1 + (P_Random() % 2);
        break;
      default:
        sound = actor.info.seesound;
    }
    if (actor.type === MT.MT_SPIDER || actor.type === MT.MT_CYBORG) S_StartSound(null, sound);
    else S_StartSound(actor, sound);
  }
  P_SetMobjState(actor, actor.info.seestate);
}

export function A_Chase(actor: Mobj): void {
  if (actor.reactiontime) actor.reactiontime--;
  if (actor.threshold) {
    if (!actor.target || actor.target.health <= 0) actor.threshold = 0;
    else actor.threshold--;
  }
  if (actor.movedir < 8) {
    actor.angle = (actor.angle & (7 << 29)) >>> 0;
    const delta = (actor.angle - (actor.movedir << 29)) | 0;
    if (delta > 0) actor.angle = (actor.angle - ANG90 / 2) >>> 0;
    else if (delta < 0) actor.angle = (actor.angle + ANG90 / 2) >>> 0;
  }
  if (!actor.target || !(actor.target.flags & MF_SHOOTABLE)) {
    if (P_LookForPlayers(actor, true)) return;
    P_SetMobjState(actor, actor.info.spawnstate);
    return;
  }
  if (actor.flags & MF_JUSTATTACKED) {
    actor.flags &= ~MF_JUSTATTACKED;
    if (g.gameskill !== Skill.sk_nightmare && !g.fastparm) P_NewChaseDir(actor);
    return;
  }
  if (actor.info.meleestate && P_CheckMeleeRange(actor)) {
    if (actor.info.attacksound) S_StartSound(actor, actor.info.attacksound);
    P_SetMobjState(actor, actor.info.meleestate);
    return;
  }
  nomissile: {
    if (actor.info.missilestate) {
      if (g.gameskill < Skill.sk_nightmare && !g.fastparm && actor.movecount) break nomissile;
      if (!P_CheckMissileRange(actor)) break nomissile;
      P_SetMobjState(actor, actor.info.missilestate);
      actor.flags |= MF_JUSTATTACKED;
      return;
    }
  }
  if (g.netgame && !actor.threshold && !P_CheckSight(actor, actor.target)) {
    if (P_LookForPlayers(actor, true)) return;
  }
  if (--actor.movecount < 0 || !P_Move(actor)) P_NewChaseDir(actor);
  if (actor.info.activesound && P_Random() < 3) S_StartSound(actor, actor.info.activesound);
}

export function A_FaceTarget(actor: Mobj): void {
  if (!actor.target) return;
  actor.flags &= ~MF_AMBUSH;
  actor.angle = R_PointToAngle2(actor.x, actor.y, actor.target.x, actor.target.y);
  if (actor.target.flags & MF_SHADOW) actor.angle = (actor.angle + ((P_Random() - P_Random()) << 21)) >>> 0;
}

function A_PosAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  let angle = actor.angle;
  const slope = P_AimLineAttack(actor, angle, MISSILERANGE);
  S_StartSound(actor, SFX.sfx_pistol);
  angle = (angle + ((P_Random() - P_Random()) << 20)) >>> 0;
  const damage = ((P_Random() % 5) + 1) * 3;
  P_LineAttack(actor, angle, MISSILERANGE, slope, damage);
}

function A_SPosAttack(actor: Mobj): void {
  if (!actor.target) return;
  S_StartSound(actor, SFX.sfx_shotgn);
  A_FaceTarget(actor);
  const bangle = actor.angle;
  const slope = P_AimLineAttack(actor, bangle, MISSILERANGE);
  for (let i = 0; i < 3; i++) {
    const angle = (bangle + ((P_Random() - P_Random()) << 20)) >>> 0;
    const damage = ((P_Random() % 5) + 1) * 3;
    P_LineAttack(actor, angle, MISSILERANGE, slope, damage);
  }
}

function A_CPosAttack(actor: Mobj): void {
  if (!actor.target) return;
  S_StartSound(actor, SFX.sfx_shotgn);
  A_FaceTarget(actor);
  const bangle = actor.angle;
  const slope = P_AimLineAttack(actor, bangle, MISSILERANGE);
  const angle = (bangle + ((P_Random() - P_Random()) << 20)) >>> 0;
  const damage = ((P_Random() % 5) + 1) * 3;
  P_LineAttack(actor, angle, MISSILERANGE, slope, damage);
}

function A_CPosRefire(actor: Mobj): void {
  A_FaceTarget(actor);
  if (P_Random() < 40) return;
  if (!actor.target || actor.target.health <= 0 || !P_CheckSight(actor, actor.target)) P_SetMobjState(actor, actor.info.seestate);
}

function A_SpidRefire(actor: Mobj): void {
  A_FaceTarget(actor);
  if (P_Random() < 10) return;
  if (!actor.target || actor.target.health <= 0 || !P_CheckSight(actor, actor.target)) P_SetMobjState(actor, actor.info.seestate);
}

function A_BspiAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  P_SpawnMissile(actor, actor.target, MT.MT_ARACHPLAZ);
}

function A_TroopAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  if (P_CheckMeleeRange(actor)) {
    S_StartSound(actor, SFX.sfx_claw);
    const damage = ((P_Random() % 8) + 1) * 3;
    P_DamageMobj(actor.target, actor, actor, damage);
    return;
  }
  P_SpawnMissile(actor, actor.target, MT.MT_TROOPSHOT);
}

function A_SargAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  if (P_CheckMeleeRange(actor)) {
    const damage = ((P_Random() % 10) + 1) * 4;
    P_DamageMobj(actor.target, actor, actor, damage);
  }
}

function A_HeadAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  if (P_CheckMeleeRange(actor)) {
    const damage = ((P_Random() % 6) + 1) * 10;
    P_DamageMobj(actor.target, actor, actor, damage);
    return;
  }
  P_SpawnMissile(actor, actor.target, MT.MT_HEADSHOT);
}

function A_CyberAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  P_SpawnMissile(actor, actor.target, MT.MT_ROCKET);
}

function A_BruisAttack(actor: Mobj): void {
  if (!actor.target) return;
  if (P_CheckMeleeRange(actor)) {
    S_StartSound(actor, SFX.sfx_claw);
    const damage = ((P_Random() % 8) + 1) * 10;
    P_DamageMobj(actor.target, actor, actor, damage);
    return;
  }
  P_SpawnMissile(actor, actor.target, MT.MT_BRUISERSHOT);
}

function A_SkelMissile(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  actor.z = (actor.z + 16 * FRACUNIT) | 0;
  const mo = P_SpawnMissile(actor, actor.target, MT.MT_TRACER);
  actor.z = (actor.z - 16 * FRACUNIT) | 0;
  mo.x = (mo.x + mo.momx) | 0;
  mo.y = (mo.y + mo.momy) | 0;
  mo.tracer = actor.target;
}

const TRACEANGLE = 0xc000000;

function A_Tracer(actor: Mobj): void {
  if (g.gametic & 3) return;
  P_SpawnPuff(actor.x, actor.y, actor.z);
  const th = P_SpawnMobj((actor.x - actor.momx) | 0, (actor.y - actor.momy) | 0, actor.z, MT.MT_SMOKE);
  th.momz = FRACUNIT;
  th.tics -= P_Random() & 3;
  if (th.tics < 1) th.tics = 1;
  const dest = actor.tracer;
  if (!dest || dest.health <= 0) return;
  let exact = R_PointToAngle2(actor.x, actor.y, dest.x, dest.y);
  if (exact !== actor.angle) {
    if (((exact - actor.angle) >>> 0) > 0x80000000) {
      actor.angle = (actor.angle - TRACEANGLE) >>> 0;
      if (((exact - actor.angle) >>> 0) < 0x80000000) actor.angle = exact;
    } else {
      actor.angle = (actor.angle + TRACEANGLE) >>> 0;
      if (((exact - actor.angle) >>> 0) > 0x80000000) actor.angle = exact;
    }
  }
  exact = actor.angle >>> ANGLETOFINESHIFT;
  actor.momx = FixedMul(actor.info.speed, finecosine[exact]);
  actor.momy = FixedMul(actor.info.speed, finesine[exact]);
  let dist = P_AproxDistance(dest.x - actor.x, dest.y - actor.y);
  dist = (dist / actor.info.speed) | 0;
  if (dist < 1) dist = 1;
  const slope = (((dest.z + 40 * FRACUNIT - actor.z) | 0) / dist) | 0;
  if (slope < actor.momz) actor.momz = (actor.momz - FRACUNIT / 8) | 0;
  else actor.momz = (actor.momz + FRACUNIT / 8) | 0;
}

function A_SkelWhoosh(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  S_StartSound(actor, SFX.sfx_skeswg);
}

function A_SkelFist(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  if (P_CheckMeleeRange(actor)) {
    const damage = ((P_Random() % 10) + 1) * 6;
    S_StartSound(actor, SFX.sfx_skepch);
    P_DamageMobj(actor.target, actor, actor, damage);
  }
}

let corpsehit: Mobj | null = null;
let viletryx = 0;
let viletryy = 0;

function PIT_VileCheck(thing: Mobj): boolean {
  if (!(thing.flags & MF_CORPSE)) return true;
  if (thing.tics !== -1) return true;
  if (thing.info.raisestate === S.S_NULL) return true;
  const maxdist = thing.info.radius + mobjinfo[MT.MT_VILE].radius;
  if (Math.abs((thing.x - viletryx) | 0) > maxdist || Math.abs((thing.y - viletryy) | 0) > maxdist) return true;
  corpsehit = thing;
  corpsehit.momx = corpsehit.momy = 0;
  corpsehit.height <<= 2;
  const check = P_CheckPosition(corpsehit, corpsehit.x, corpsehit.y);
  corpsehit.height >>= 2;
  if (!check) return true;
  return false;
}

function A_VileChase(actor: Mobj): void {
  if (actor.movedir !== Dir.DI_NODIR) {
    viletryx = (actor.x + Math.imul(actor.info.speed, xspeed[actor.movedir])) | 0;
    viletryy = (actor.y + Math.imul(actor.info.speed, yspeed[actor.movedir])) | 0;
    const xl = ((viletryx - lv.bmaporgx - MAXRADIUS * 2) | 0) >> MAPBLOCKSHIFT;
    const xh = ((viletryx - lv.bmaporgx + MAXRADIUS * 2) | 0) >> MAPBLOCKSHIFT;
    const yl = ((viletryy - lv.bmaporgy - MAXRADIUS * 2) | 0) >> MAPBLOCKSHIFT;
    const yh = ((viletryy - lv.bmaporgy + MAXRADIUS * 2) | 0) >> MAPBLOCKSHIFT;
    for (let bx = xl; bx <= xh; bx++) {
      for (let by = yl; by <= yh; by++) {
        if (!P_BlockThingsIterator(bx, by, PIT_VileCheck)) {
          const ch = corpsehit!;
          const temp = actor.target;
          actor.target = ch;
          A_FaceTarget(actor);
          actor.target = temp;
          P_SetMobjState(actor, S.S_VILE_HEAL1);
          S_StartSound(ch, SFX.sfx_slop);
          const info = ch.info;
          P_SetMobjState(ch, info.raisestate);
          ch.height <<= 2;
          ch.flags = info.flags;
          ch.health = info.spawnhealth;
          ch.target = null;
          return;
        }
      }
    }
  }
  A_Chase(actor);
}

function A_VileStart(actor: Mobj): void {
  S_StartSound(actor, SFX.sfx_vilatk);
}

function A_StartFire(actor: Mobj): void {
  S_StartSound(actor, SFX.sfx_flamst);
  A_Fire(actor);
}

function A_FireCrackle(actor: Mobj): void {
  S_StartSound(actor, SFX.sfx_flame);
  A_Fire(actor);
}

function A_Fire(actor: Mobj): void {
  const dest = actor.tracer;
  if (!dest) return;
  if (!P_CheckSight(actor.target!, dest)) return;
  const an = dest.angle >>> ANGLETOFINESHIFT;
  P_UnsetThingPosition(actor);
  actor.x = (dest.x + FixedMul(24 * FRACUNIT, finecosine[an])) | 0;
  actor.y = (dest.y + FixedMul(24 * FRACUNIT, finesine[an])) | 0;
  actor.z = dest.z;
  P_SetThingPosition(actor);
}

function A_VileTarget(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  const fog = P_SpawnMobj(actor.target.x, actor.target.x, actor.target.z, MT.MT_FIRE); // vanilla passes x twice
  actor.tracer = fog;
  fog.target = actor;
  fog.tracer = actor.target;
  A_Fire(fog);
}

function A_VileAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  if (!P_CheckSight(actor, actor.target)) return;
  S_StartSound(actor, SFX.sfx_barexp);
  P_DamageMobj(actor.target, actor, actor, 20);
  actor.target.momz = ((1000 * FRACUNIT) / actor.target.info.mass) | 0;
  const an = actor.angle >>> ANGLETOFINESHIFT;
  const fire = actor.tracer;
  if (!fire) return;
  fire.x = (actor.target.x - FixedMul(24 * FRACUNIT, finecosine[an])) | 0;
  fire.y = (actor.target.y - FixedMul(24 * FRACUNIT, finesine[an])) | 0;
  P_RadiusAttack(fire, actor, 70);
}

const FATSPREAD = ANG90 / 8;

function A_FatRaise(actor: Mobj): void {
  A_FaceTarget(actor);
  S_StartSound(actor, SFX.sfx_manatk);
}

function setMissileMom(mo: Mobj): void {
  const an = mo.angle >>> ANGLETOFINESHIFT;
  mo.momx = FixedMul(mo.info.speed, finecosine[an]);
  mo.momy = FixedMul(mo.info.speed, finesine[an]);
}

function A_FatAttack1(actor: Mobj): void {
  A_FaceTarget(actor);
  actor.angle = (actor.angle + FATSPREAD) >>> 0;
  P_SpawnMissile(actor, actor.target!, MT.MT_FATSHOT);
  const mo = P_SpawnMissile(actor, actor.target!, MT.MT_FATSHOT);
  mo.angle = (mo.angle + FATSPREAD) >>> 0;
  setMissileMom(mo);
}

function A_FatAttack2(actor: Mobj): void {
  A_FaceTarget(actor);
  actor.angle = (actor.angle - FATSPREAD) >>> 0;
  P_SpawnMissile(actor, actor.target!, MT.MT_FATSHOT);
  const mo = P_SpawnMissile(actor, actor.target!, MT.MT_FATSHOT);
  mo.angle = (mo.angle - FATSPREAD * 2) >>> 0;
  setMissileMom(mo);
}

function A_FatAttack3(actor: Mobj): void {
  A_FaceTarget(actor);
  let mo = P_SpawnMissile(actor, actor.target!, MT.MT_FATSHOT);
  mo.angle = (mo.angle - FATSPREAD / 2) >>> 0;
  setMissileMom(mo);
  mo = P_SpawnMissile(actor, actor.target!, MT.MT_FATSHOT);
  mo.angle = (mo.angle + FATSPREAD / 2) >>> 0;
  setMissileMom(mo);
}

const SKULLSPEED = 20 * FRACUNIT;

function A_SkullAttack(actor: Mobj): void {
  if (!actor.target) return;
  const dest = actor.target;
  actor.flags |= MF_SKULLFLY;
  S_StartSound(actor, actor.info.attacksound);
  A_FaceTarget(actor);
  const an = actor.angle >>> ANGLETOFINESHIFT;
  actor.momx = FixedMul(SKULLSPEED, finecosine[an]);
  actor.momy = FixedMul(SKULLSPEED, finesine[an]);
  let dist = P_AproxDistance(dest.x - actor.x, dest.y - actor.y);
  dist = (dist / SKULLSPEED) | 0;
  if (dist < 1) dist = 1;
  actor.momz = (((dest.z + (dest.height >> 1) - actor.z) | 0) / dist) | 0;
}

function A_PainShootSkull(actor: Mobj, angle: number): void {
  let count = 0;
  forEachMobj((mo) => {
    if (mo.type === MT.MT_SKULL) count++;
  });
  if (count > 20) return;
  const an = angle >>> ANGLETOFINESHIFT;
  const prestep = (4 * FRACUNIT + ((3 * (actor.info.radius + mobjinfo[MT.MT_SKULL].radius)) / 2)) | 0;
  const x = (actor.x + FixedMul(prestep, finecosine[an])) | 0;
  const y = (actor.y + FixedMul(prestep, finesine[an])) | 0;
  const z = (actor.z + 8 * FRACUNIT) | 0;
  const newmobj = P_SpawnMobj(x, y, z, MT.MT_SKULL);
  if (!P_TryMove(newmobj, newmobj.x, newmobj.y)) {
    P_DamageMobj(newmobj, actor, actor, 10000);
    return;
  }
  newmobj.target = actor.target;
  A_SkullAttack(newmobj);
}

function A_PainAttack(actor: Mobj): void {
  if (!actor.target) return;
  A_FaceTarget(actor);
  A_PainShootSkull(actor, actor.angle);
}

function A_PainDie(actor: Mobj): void {
  A_Fall(actor);
  A_PainShootSkull(actor, (actor.angle + ANG90) >>> 0);
  A_PainShootSkull(actor, (actor.angle + ANG180) >>> 0);
  A_PainShootSkull(actor, (actor.angle + ANG270) >>> 0);
}

function A_Scream(actor: Mobj): void {
  let sound: number;
  switch (actor.info.deathsound) {
    case 0:
      return;
    case SFX.sfx_podth1:
    case SFX.sfx_podth2:
    case SFX.sfx_podth3:
      sound = SFX.sfx_podth1 + (P_Random() % 3);
      break;
    case SFX.sfx_bgdth1:
    case SFX.sfx_bgdth2:
      sound = SFX.sfx_bgdth1 + (P_Random() % 2);
      break;
    default:
      sound = actor.info.deathsound;
  }
  if (actor.type === MT.MT_SPIDER || actor.type === MT.MT_CYBORG) S_StartSound(null, sound);
  else S_StartSound(actor, sound);
}

function A_XScream(actor: Mobj): void {
  S_StartSound(actor, SFX.sfx_slop);
}

function A_Pain(actor: Mobj): void {
  if (actor.info.painsound) S_StartSound(actor, actor.info.painsound);
}

export function A_Fall(actor: Mobj): void {
  actor.flags &= ~MF_SOLID;
}

function A_Explode(thingy: Mobj): void {
  P_RadiusAttack(thingy, thingy.target, 128);
}

function A_BossDeath(mo: Mobj): void {
  if (g.gamemode === GameMode.commercial) {
    if (g.gamemap !== 7) return;
    if (mo.type !== MT.MT_FATSO && mo.type !== MT.MT_BABY) return;
  } else {
    switch (g.gameepisode) {
      case 1:
        if (g.gamemap !== 8 || mo.type !== MT.MT_BRUISER) return;
        break;
      case 2:
        if (g.gamemap !== 8 || mo.type !== MT.MT_CYBORG) return;
        break;
      case 3:
        if (g.gamemap !== 8 || mo.type !== MT.MT_SPIDER) return;
        break;
      case 4:
        if (g.gamemap === 6) {
          if (mo.type !== MT.MT_CYBORG) return;
        } else if (g.gamemap === 8) {
          if (mo.type !== MT.MT_SPIDER) return;
        } else return;
        break;
      default:
        if (g.gamemap !== 8) return;
    }
  }
  let i: number;
  for (i = 0; i < MAXPLAYERS; i++) if (g.playeringame[i] && g.players[i].health > 0) break;
  if (i === MAXPLAYERS) return;
  let alive = false;
  forEachMobj((mo2) => {
    if (mo2 !== mo && mo2.type === mo.type && mo2.health > 0) {
      alive = true;
      return false;
    }
  });
  if (alive) return;
  if (g.gamemode === GameMode.commercial) {
    if (g.gamemap === 7) {
      if (mo.type === MT.MT_FATSO) {
        EV_DoFloor(junkLine(666), FloorType.lowerFloorToLowest);
        return;
      }
      if (mo.type === MT.MT_BABY) {
        EV_DoFloor(junkLine(667), FloorType.raiseToTexture);
        return;
      }
    }
  } else {
    switch (g.gameepisode) {
      case 1:
        EV_DoFloor(junkLine(666), FloorType.lowerFloorToLowest);
        return;
      case 4:
        if (g.gamemap === 6) {
          EV_DoDoor(junkLine(666), DoorType.blazeOpen);
          return;
        }
        if (g.gamemap === 8) {
          EV_DoFloor(junkLine(666), FloorType.lowerFloorToLowest);
          return;
        }
    }
  }
  G_ExitLevel();
}

function A_Hoof(mo: Mobj): void {
  S_StartSound(mo, SFX.sfx_hoof);
  A_Chase(mo);
}

function A_Metal(mo: Mobj): void {
  S_StartSound(mo, SFX.sfx_metal);
  A_Chase(mo);
}

function A_BabyMetal(mo: Mobj): void {
  S_StartSound(mo, SFX.sfx_bspwlk);
  A_Chase(mo);
}

const braintargets: Mobj[] = [];
let braintargeton = 0;

function A_BrainAwake(_mo: Mobj): void {
  braintargets.length = 0;
  braintargeton = 0;
  forEachMobj((m) => {
    if (m.type === MT.MT_BOSSTARGET) braintargets.push(m);
  });
  S_StartSound(null, SFX.sfx_bossit);
}

function A_BrainPain(_mo: Mobj): void {
  S_StartSound(null, SFX.sfx_bospn);
}

function A_BrainScream(mo: Mobj): void {
  for (let x = (mo.x - 196 * FRACUNIT) | 0; x < mo.x + 320 * FRACUNIT; x = (x + FRACUNIT * 8) | 0) {
    const y = (mo.y - 320 * FRACUNIT) | 0;
    const z = (128 + P_Random() * 2 * FRACUNIT) | 0;
    const th = P_SpawnMobj(x, y, z, MT.MT_ROCKET);
    th.momz = P_Random() * 512;
    P_SetMobjState(th, S.S_BRAINEXPLODE1);
    th.tics -= P_Random() & 7;
    if (th.tics < 1) th.tics = 1;
  }
  S_StartSound(null, SFX.sfx_bosdth);
}

function A_BrainExplode(mo: Mobj): void {
  const x = (mo.x + (P_Random() - P_Random()) * 2048) | 0;
  const y = mo.y;
  const z = (128 + P_Random() * 2 * FRACUNIT) | 0;
  const th = P_SpawnMobj(x, y, z, MT.MT_ROCKET);
  th.momz = P_Random() * 512;
  P_SetMobjState(th, S.S_BRAINEXPLODE1);
  th.tics -= P_Random() & 7;
  if (th.tics < 1) th.tics = 1;
}

function A_BrainDie(_mo: Mobj): void {
  G_ExitLevel();
}

let brainEasy = 0;

function A_BrainSpit(mo: Mobj): void {
  brainEasy ^= 1;
  if (g.gameskill <= Skill.sk_easy && !brainEasy) return;
  if (!braintargets.length) return;
  const targ = braintargets[braintargeton];
  braintargeton = (braintargeton + 1) % braintargets.length;
  const newmobj = P_SpawnMissile(mo, targ, MT.MT_SPAWNSHOT);
  newmobj.target = targ;
  newmobj.reactiontime = newmobj.momy ? ((((targ.y - mo.y) | 0) / newmobj.momy) | 0) / newmobj.state.tics | 0 : 0;
  S_StartSound(null, SFX.sfx_bospit);
}

function A_SpawnSound(mo: Mobj): void {
  S_StartSound(mo, SFX.sfx_boscub);
  A_SpawnFly(mo);
}

function A_SpawnFly(mo: Mobj): void {
  if (--mo.reactiontime) return;
  const targ = mo.target!;
  const fog = P_SpawnMobj(targ.x, targ.y, targ.z, MT.MT_SPAWNFIRE);
  S_StartSound(fog, SFX.sfx_telept);
  const r = P_Random();
  let type: number;
  if (r < 50) type = MT.MT_TROOP;
  else if (r < 90) type = MT.MT_SERGEANT;
  else if (r < 120) type = MT.MT_SHADOWS;
  else if (r < 130) type = MT.MT_PAIN;
  else if (r < 160) type = MT.MT_HEAD;
  else if (r < 162) type = MT.MT_VILE;
  else if (r < 172) type = MT.MT_UNDEAD;
  else if (r < 192) type = MT.MT_BABY;
  else if (r < 222) type = MT.MT_FATSO;
  else if (r < 246) type = MT.MT_KNIGHT;
  else type = MT.MT_BRUISER;
  const newmobj = P_SpawnMobj(targ.x, targ.y, targ.z, type);
  if (P_LookForPlayers(newmobj, true)) P_SetMobjState(newmobj, newmobj.info.seestate);
  P_TeleportMove(newmobj, newmobj.x, newmobj.y);
  P_RemoveMobj(mo);
}

function A_PlayerScream(mo: Mobj): void {
  let sound = SFX.sfx_pldeth;
  if (g.gamemode === GameMode.commercial && mo.health < -50) sound = SFX.sfx_pdiehi;
  S_StartSound(mo, sound);
}

registerActions({
  A_KeenDie, A_Look, A_Chase, A_FaceTarget, A_PosAttack, A_SPosAttack, A_CPosAttack, A_CPosRefire, A_SpidRefire,
  A_BspiAttack, A_TroopAttack, A_SargAttack, A_HeadAttack, A_CyberAttack, A_BruisAttack, A_SkelMissile, A_Tracer,
  A_SkelWhoosh, A_SkelFist, A_VileChase, A_VileStart, A_StartFire, A_FireCrackle, A_Fire, A_VileTarget, A_VileAttack,
  A_FatRaise, A_FatAttack1, A_FatAttack2, A_FatAttack3, A_SkullAttack, A_PainAttack, A_PainDie, A_Scream, A_XScream,
  A_Pain, A_Fall, A_Explode, A_BossDeath, A_Hoof, A_Metal, A_BabyMetal, A_BrainAwake, A_BrainPain, A_BrainScream,
  A_BrainExplode, A_BrainDie, A_BrainSpit, A_SpawnSound, A_SpawnFly, A_PlayerScream,
});

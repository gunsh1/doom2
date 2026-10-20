// p_mobj.c — map object spawning, movement and state changes.
import { FRACBITS, FRACUNIT, FixedMul } from '../core/fixed';
import { finesine, finecosine, ANG45, ANGLETOFINESHIFT } from '../core/tables';
import { P_Random } from '../core/random';
import {
  Mobj, THINKER_REMOVED, MF_SKULLFLY, MF_MISSILE, MF_CORPSE, MF_FLOAT, MF_INFLOAT, MF_NOGRAVITY, MF_NOCLIP, MF_COUNTKILL,
  MF_SPECIAL, MF_DROPPED, MF_SPAWNCEILING, MF_TRANSSHIFT, MF_COUNTITEM, MF_AMBUSH, MF_NOTDMATCH, MF_SHADOW,
  MAXMOVE, FLOATSPEED, GRAVITY, VIEWHEIGHT, ONFLOORZ, ONCEILINGZ, ITEMQUESIZE, MELEERANGE, CF_NOMOMENTUM, MTF_AMBUSH,
  MAXPLAYERS, PlayerState, Skill, Card, type MapThing,
} from '../doom/defs';
import { states, mobjinfo, S, MT, NUMMOBJTYPES } from '../doom/info';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { P_AddThinker, P_RemoveThinker } from './p_tick';
import { P_SetThingPosition, P_UnsetThingPosition, P_AproxDistance } from './p_maputl';
import { P_TryMove, P_SlideMove, P_CheckPosition, P_AimLineAttack, mapState } from './p_map';
import { P_SetupPsprites } from './p_pspr';
import { R_PointInSubsector, R_PointToAngle2 } from '../render/renderer';
import { S_StartSound, S_StopSound } from '../sound/s_sound';
import { G_PlayerReborn } from '../game/g_game';
import { ST_Start } from '../game/st_stuff';
import { HU_Start } from '../game/hu_stuff';

const STOPSPEED = 0x1000;
const FRICTION = 0xe800;

export function P_SetMobjState(mobj: Mobj, state: number): boolean {
  do {
    if (state === S.S_NULL) {
      mobj.state = states[S.S_NULL];
      P_RemoveMobj(mobj);
      return false;
    }
    const st = states[state];
    mobj.state = st;
    mobj.tics = st.tics;
    mobj.sprite = st.sprite;
    mobj.frame = st.frame;
    if (st.action) st.action(mobj);
    state = st.nextstate;
  } while (!mobj.tics);
  return true;
}

export function P_ExplodeMissile(mo: Mobj): void {
  mo.momx = mo.momy = mo.momz = 0;
  P_SetMobjState(mo, mobjinfo[mo.type].deathstate);
  mo.tics -= P_Random() & 3;
  if (mo.tics < 1) mo.tics = 1;
  mo.flags &= ~MF_MISSILE;
  if (mo.info.deathsound) S_StartSound(mo, mo.info.deathsound);
}

function P_XYMovement(mo: Mobj): void {
  if (!mo.momx && !mo.momy) {
    if (mo.flags & MF_SKULLFLY) {
      mo.flags &= ~MF_SKULLFLY;
      mo.momx = mo.momy = mo.momz = 0;
      P_SetMobjState(mo, mo.info.spawnstate);
    }
    return;
  }
  const player = mo.player;
  if (mo.momx > MAXMOVE) mo.momx = MAXMOVE;
  else if (mo.momx < -MAXMOVE) mo.momx = -MAXMOVE;
  if (mo.momy > MAXMOVE) mo.momy = MAXMOVE;
  else if (mo.momy < -MAXMOVE) mo.momy = -MAXMOVE;
  let xmove = mo.momx;
  let ymove = mo.momy;
  do {
    let ptryx: number, ptryy: number;
    if (xmove > MAXMOVE / 2 || ymove > MAXMOVE / 2) {
      ptryx = (mo.x + ((xmove / 2) | 0)) | 0;
      ptryy = (mo.y + ((ymove / 2) | 0)) | 0;
      xmove >>= 1;
      ymove >>= 1;
    } else {
      ptryx = (mo.x + xmove) | 0;
      ptryy = (mo.y + ymove) | 0;
      xmove = ymove = 0;
    }
    if (!P_TryMove(mo, ptryx, ptryy)) {
      if (mo.player) P_SlideMove(mo);
      else if (mo.flags & MF_MISSILE) {
        const cl = mapState.ceilingline;
        if (cl && cl.backsector && cl.backsector.ceilingpic === g.skyflatnum) {
          P_RemoveMobj(mo);
          return;
        }
        P_ExplodeMissile(mo);
      } else mo.momx = mo.momy = 0;
    }
  } while (xmove || ymove);

  if (player && player.cheats & CF_NOMOMENTUM) {
    mo.momx = mo.momy = 0;
    return;
  }
  if (mo.flags & (MF_MISSILE | MF_SKULLFLY)) return;
  if (mo.z > mo.floorz) return;
  if (mo.flags & MF_CORPSE) {
    if (mo.momx > FRACUNIT / 4 || mo.momx < -FRACUNIT / 4 || mo.momy > FRACUNIT / 4 || mo.momy < -FRACUNIT / 4) {
      if (mo.floorz !== mo.subsector.sector.floorheight) return;
    }
  }
  if (
    mo.momx > -STOPSPEED && mo.momx < STOPSPEED && mo.momy > -STOPSPEED && mo.momy < STOPSPEED &&
    (!player || (player.cmd.forwardmove === 0 && player.cmd.sidemove === 0))
  ) {
    if (player && ((player.mo!.state.index - S.S_PLAY_RUN1) >>> 0) < 4) P_SetMobjState(player.mo!, S.S_PLAY);
    mo.momx = 0;
    mo.momy = 0;
  } else {
    mo.momx = FixedMul(mo.momx, FRICTION);
    mo.momy = FixedMul(mo.momy, FRICTION);
  }
}

function P_ZMovement(mo: Mobj): void {
  if (mo.player && mo.z < mo.floorz) {
    mo.player.viewheight = (mo.player.viewheight - (mo.floorz - mo.z)) | 0;
    mo.player.deltaviewheight = (VIEWHEIGHT - mo.player.viewheight) >> 3;
  }
  mo.z = (mo.z + mo.momz) | 0;
  if (mo.flags & MF_FLOAT && mo.target) {
    if (!(mo.flags & MF_SKULLFLY) && !(mo.flags & MF_INFLOAT)) {
      const dist = P_AproxDistance(mo.x - mo.target.x, mo.y - mo.target.y);
      const delta = (mo.target.z + (mo.height >> 1) - mo.z) | 0;
      if (delta < 0 && dist < -(delta * 3)) mo.z = (mo.z - FLOATSPEED) | 0;
      else if (delta > 0 && dist < delta * 3) mo.z = (mo.z + FLOATSPEED) | 0;
    }
  }
  if (mo.z <= mo.floorz) {
    if (mo.flags & MF_SKULLFLY) mo.momz = -mo.momz | 0;
    if (mo.momz < 0) {
      if (mo.player && mo.momz < -GRAVITY * 8) {
        mo.player.deltaviewheight = mo.momz >> 3;
        S_StartSound(mo, SFX.sfx_oof);
      }
      mo.momz = 0;
    }
    mo.z = mo.floorz;
    if (mo.flags & MF_MISSILE && !(mo.flags & MF_NOCLIP)) {
      P_ExplodeMissile(mo);
      return;
    }
  } else if (!(mo.flags & MF_NOGRAVITY)) {
    if (mo.momz === 0) mo.momz = -GRAVITY * 2;
    else mo.momz = (mo.momz - GRAVITY) | 0;
  }
  if (mo.z + mo.height > mo.ceilingz) {
    if (mo.momz > 0) mo.momz = 0;
    mo.z = (mo.ceilingz - mo.height) | 0;
    if (mo.flags & MF_SKULLFLY) mo.momz = -mo.momz | 0;
    if (mo.flags & MF_MISSILE && !(mo.flags & MF_NOCLIP)) {
      P_ExplodeMissile(mo);
      return;
    }
  }
}

export function mapAngle(angle: number): number {
  return Math.imul(ANG45, Math.trunc(angle / 45)) >>> 0;
}

function P_NightmareRespawn(mobj: Mobj): void {
  const x = mobj.spawnpoint.x << FRACBITS;
  const y = mobj.spawnpoint.y << FRACBITS;
  if (!P_CheckPosition(mobj, x, y)) return;
  let mo = P_SpawnMobj(mobj.x, mobj.y, mobj.subsector.sector.floorheight, MT.MT_TFOG);
  S_StartSound(mo, SFX.sfx_telept);
  const ss = R_PointInSubsector(x, y);
  mo = P_SpawnMobj(x, y, ss.sector.floorheight, MT.MT_TFOG);
  S_StartSound(mo, SFX.sfx_telept);
  const mthing = mobj.spawnpoint;
  const z = mobj.info.flags & MF_SPAWNCEILING ? ONCEILINGZ : ONFLOORZ;
  mo = P_SpawnMobj(x, y, z, mobj.type);
  mo.spawnpoint = mobj.spawnpoint;
  mo.angle = mapAngle(mthing.angle);
  if (mthing.options & MTF_AMBUSH) mo.flags |= MF_AMBUSH;
  mo.reactiontime = 18;
  P_RemoveMobj(mobj);
}

export function P_MobjThinker(mobj: Mobj): void {
  if (mobj.momx || mobj.momy || mobj.flags & MF_SKULLFLY) {
    P_XYMovement(mobj);
    if (mobj.func === THINKER_REMOVED) return;
  }
  if (mobj.z !== mobj.floorz || mobj.momz) {
    P_ZMovement(mobj);
    if (mobj.func === THINKER_REMOVED) return;
  }
  if (mobj.tics !== -1) {
    mobj.tics--;
    if (!mobj.tics) if (!P_SetMobjState(mobj, mobj.state.nextstate)) return;
  } else {
    if (!(mobj.flags & MF_COUNTKILL)) return;
    if (!g.respawnmonsters) return;
    mobj.movecount++;
    if (mobj.movecount < 12 * 35) return;
    if (g.leveltime & 31) return;
    if (P_Random() > 4) return;
    P_NightmareRespawn(mobj);
  }
}

export function P_SpawnMobj(x: number, y: number, z: number, type: number): Mobj {
  const mobj = new Mobj();
  const info = mobjinfo[type];
  mobj.type = type;
  mobj.info = info;
  mobj.x = x;
  mobj.y = y;
  mobj.radius = info.radius;
  mobj.height = info.height;
  mobj.flags = info.flags;
  mobj.health = info.spawnhealth;
  if (g.gameskill !== Skill.sk_nightmare) mobj.reactiontime = info.reactiontime;
  mobj.lastlook = P_Random() % MAXPLAYERS;
  const st = states[info.spawnstate];
  mobj.state = st;
  mobj.tics = st.tics;
  mobj.sprite = st.sprite;
  mobj.frame = st.frame;
  P_SetThingPosition(mobj);
  mobj.floorz = mobj.subsector.sector.floorheight;
  mobj.ceilingz = mobj.subsector.sector.ceilingheight;
  if (z === ONFLOORZ) mobj.z = mobj.floorz;
  else if (z === ONCEILINGZ) mobj.z = (mobj.ceilingz - mobj.info.height) | 0;
  else mobj.z = z;
  mobj.func = P_MobjThinker;
  P_AddThinker(mobj);
  return mobj;
}

const itemrespawnque: MapThing[] = new Array(ITEMQUESIZE);
const itemrespawntime = new Int32Array(ITEMQUESIZE);
let iquehead = 0;
let iquetail = 0;

export function resetItemQueue(): void {
  iquehead = iquetail = 0;
}

export function P_RemoveMobj(mobj: Mobj): void {
  if (mobj.flags & MF_SPECIAL && !(mobj.flags & MF_DROPPED) && mobj.type !== MT.MT_INV && mobj.type !== MT.MT_INS) {
    itemrespawnque[iquehead] = mobj.spawnpoint;
    itemrespawntime[iquehead] = g.leveltime;
    iquehead = (iquehead + 1) & (ITEMQUESIZE - 1);
    if (iquehead === iquetail) iquetail = (iquetail + 1) & (ITEMQUESIZE - 1);
  }
  P_UnsetThingPosition(mobj);
  S_StopSound(mobj);
  P_RemoveThinker(mobj);
}

export function P_RespawnSpecials(): void {
  if (g.deathmatch !== 2) return;
  if (iquehead === iquetail) return;
  if (g.leveltime - itemrespawntime[iquetail] < 30 * 35) return;
  const mthing = itemrespawnque[iquetail];
  const x = mthing.x << FRACBITS;
  const y = mthing.y << FRACBITS;
  const ss = R_PointInSubsector(x, y);
  let mo = P_SpawnMobj(x, y, ss.sector.floorheight, MT.MT_IFOG);
  S_StartSound(mo, SFX.sfx_itmbk);
  let i: number;
  for (i = 0; i < NUMMOBJTYPES; i++) if (mthing.type === mobjinfo[i].doomednum) break;
  const z = mobjinfo[i].flags & MF_SPAWNCEILING ? ONCEILINGZ : ONFLOORZ;
  mo = P_SpawnMobj(x, y, z, i);
  mo.spawnpoint = mthing;
  mo.angle = mapAngle(mthing.angle);
  iquetail = (iquetail + 1) & (ITEMQUESIZE - 1);
}

export function P_SpawnPlayer(mthing: MapThing): void {
  if (!g.playeringame[mthing.type - 1]) return;
  const p = g.players[mthing.type - 1];
  if (p.playerstate === PlayerState.PST_REBORN) G_PlayerReborn(mthing.type - 1);
  const x = mthing.x << FRACBITS;
  const y = mthing.y << FRACBITS;
  const mobj = P_SpawnMobj(x, y, ONFLOORZ, MT.MT_PLAYER);
  if (mthing.type > 1) mobj.flags |= (mthing.type - 1) << MF_TRANSSHIFT;
  mobj.angle = mapAngle(mthing.angle);
  mobj.player = p;
  mobj.health = p.health;
  p.mo = mobj;
  p.playerstate = PlayerState.PST_LIVE;
  p.refire = 0;
  p.message = null;
  p.damagecount = 0;
  p.bonuscount = 0;
  p.extralight = 0;
  p.fixedcolormap = 0;
  p.viewheight = VIEWHEIGHT;
  P_SetupPsprites(p);
  if (g.deathmatch) for (let i = 0; i < Card.NUMCARDS; i++) p.cards[i] = true;
  if (mthing.type - 1 === g.consoleplayer) {
    ST_Start();
    HU_Start();
  }
}

export function P_SpawnMapThing(mthing: MapThing): void {
  if (mthing.type === 11) {
    if (g.deathmatchstarts.length < 10) g.deathmatchstarts.push({ ...mthing });
    return;
  }
  if (mthing.type <= 4) {
    g.playerstarts[mthing.type - 1] = { ...mthing };
    if (!g.deathmatch) P_SpawnPlayer(mthing);
    return;
  }
  if (!g.netgame && mthing.options & 16) return;
  let bit: number;
  if (g.gameskill === Skill.sk_baby) bit = 1;
  else if (g.gameskill === Skill.sk_nightmare) bit = 4;
  else bit = 1 << (g.gameskill - 1);
  if (!(mthing.options & bit)) return;
  let i: number;
  for (i = 0; i < NUMMOBJTYPES; i++) if (mthing.type === mobjinfo[i].doomednum) break;
  if (i === NUMMOBJTYPES) throw new Error(`P_SpawnMapThing: Unknown type ${mthing.type} at (${mthing.x}, ${mthing.y})`);
  if (g.deathmatch && mobjinfo[i].flags & MF_NOTDMATCH) return;
  if (g.nomonsters && (i === MT.MT_SKULL || mobjinfo[i].flags & MF_COUNTKILL)) return;
  const x = mthing.x << FRACBITS;
  const y = mthing.y << FRACBITS;
  const z = mobjinfo[i].flags & MF_SPAWNCEILING ? ONCEILINGZ : ONFLOORZ;
  const mobj = P_SpawnMobj(x, y, z, i);
  mobj.spawnpoint = mthing;
  if (mobj.tics > 0) mobj.tics = 1 + (P_Random() % mobj.tics);
  if (mobj.flags & MF_COUNTKILL) g.totalkills++;
  if (mobj.flags & MF_COUNTITEM) g.totalitems++;
  mobj.angle = mapAngle(mthing.angle);
  if (mthing.options & MTF_AMBUSH) mobj.flags |= MF_AMBUSH;
}

export function P_SpawnPuff(x: number, y: number, z: number): void {
  z = (z + ((P_Random() - P_Random()) << 10)) | 0;
  const th = P_SpawnMobj(x, y, z, MT.MT_PUFF);
  th.momz = FRACUNIT;
  th.tics -= P_Random() & 3;
  if (th.tics < 1) th.tics = 1;
  if (mapState.attackrange === MELEERANGE) P_SetMobjState(th, S.S_PUFF3);
}

export function P_SpawnBlood(x: number, y: number, z: number, damage: number): void {
  z = (z + ((P_Random() - P_Random()) << 10)) | 0;
  const th = P_SpawnMobj(x, y, z, MT.MT_BLOOD);
  th.momz = FRACUNIT * 2;
  th.tics -= P_Random() & 3;
  if (th.tics < 1) th.tics = 1;
  if (damage <= 12 && damage >= 9) P_SetMobjState(th, S.S_BLOOD2);
  else if (damage < 9) P_SetMobjState(th, S.S_BLOOD3);
}

export function P_CheckMissileSpawn(th: Mobj): void {
  th.tics -= P_Random() & 3;
  if (th.tics < 1) th.tics = 1;
  th.x = (th.x + (th.momx >> 1)) | 0;
  th.y = (th.y + (th.momy >> 1)) | 0;
  th.z = (th.z + (th.momz >> 1)) | 0;
  if (!P_TryMove(th, th.x, th.y)) P_ExplodeMissile(th);
}

export function P_SpawnMissile(source: Mobj, dest: Mobj, type: number): Mobj {
  const th = P_SpawnMobj(source.x, source.y, (source.z + 4 * 8 * FRACUNIT) | 0, type);
  if (th.info.seesound) S_StartSound(th, th.info.seesound);
  th.target = source;
  let an = R_PointToAngle2(source.x, source.y, dest.x, dest.y);
  if (dest.flags & MF_SHADOW) an = (an + ((P_Random() - P_Random()) << 20)) >>> 0;
  th.angle = an;
  an >>>= ANGLETOFINESHIFT;
  th.momx = FixedMul(th.info.speed, finecosine[an]);
  th.momy = FixedMul(th.info.speed, finesine[an]);
  let dist = P_AproxDistance(dest.x - source.x, dest.y - source.y);
  dist = (dist / th.info.speed) | 0;
  if (dist < 1) dist = 1;
  th.momz = (((dest.z - source.z) | 0) / dist) | 0;
  P_CheckMissileSpawn(th);
  return th;
}

export function P_SpawnPlayerMissile(source: Mobj, type: number): void {
  let an = source.angle;
  let slope = P_AimLineAttack(source, an, 16 * 64 * FRACUNIT);
  if (!mapState.linetarget) {
    an = (an + (1 << 26)) >>> 0;
    slope = P_AimLineAttack(source, an, 16 * 64 * FRACUNIT);
    if (!mapState.linetarget) {
      an = (an - (2 << 26)) >>> 0;
      slope = P_AimLineAttack(source, an, 16 * 64 * FRACUNIT);
    }
    if (!mapState.linetarget) {
      an = source.angle;
      slope = 0;
    }
  }
  const th = P_SpawnMobj(source.x, source.y, (source.z + 4 * 8 * FRACUNIT) | 0, type);
  if (th.info.seesound) S_StartSound(th, th.info.seesound);
  th.target = source;
  th.angle = an;
  th.momx = FixedMul(th.info.speed, finecosine[an >>> ANGLETOFINESHIFT]);
  th.momy = FixedMul(th.info.speed, finesine[an >>> ANGLETOFINESHIFT]);
  th.momz = FixedMul(th.info.speed, slope);
  P_CheckMissileSpawn(th);
}

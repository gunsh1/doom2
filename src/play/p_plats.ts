// p_plats.c — lifts and moving platforms.
import { FRACUNIT } from '../core/fixed';
import { P_Random } from '../core/random';
import { Plat, PlatStatus, PlatType, MoveResult, MAXPLATS, PLATSPEED, PLATWAIT, type Line } from '../doom/defs';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { P_AddThinker, P_RemoveThinker } from './p_tick';
import { T_MovePlane } from './p_floor';
import { P_FindSectorFromLineTag, P_FindNextHighestFloor, P_FindLowestFloorSurrounding, P_FindHighestFloorSurrounding } from './p_spec';
import { S_StartSound } from '../sound/s_sound';

export const activeplats: (Plat | null)[] = new Array(MAXPLATS).fill(null);

export function clearActivePlats(): void {
  activeplats.fill(null);
}

export function T_PlatRaise(plat: Plat): void {
  const snd = plat.sector.soundorg;
  switch (plat.status) {
    case PlatStatus.up: {
      const res = T_MovePlane(plat.sector, plat.speed, plat.high, plat.crush, 0, 1);
      if (plat.type === PlatType.raiseAndChange || plat.type === PlatType.raiseToNearestAndChange) {
        if (!(g.leveltime & 7)) S_StartSound(snd, SFX.sfx_stnmov);
      }
      if (res === MoveResult.crushed && !plat.crush) {
        plat.count = plat.wait;
        plat.status = PlatStatus.down;
        S_StartSound(snd, SFX.sfx_pstart);
      } else if (res === MoveResult.pastdest) {
        plat.count = plat.wait;
        plat.status = PlatStatus.waiting;
        S_StartSound(snd, SFX.sfx_pstop);
        switch (plat.type) {
          case PlatType.blazeDWUS:
          case PlatType.downWaitUpStay:
          case PlatType.raiseAndChange:
          case PlatType.raiseToNearestAndChange:
            P_RemoveActivePlat(plat);
            break;
        }
      }
      break;
    }
    case PlatStatus.down: {
      const res = T_MovePlane(plat.sector, plat.speed, plat.low, false, 0, -1);
      if (res === MoveResult.pastdest) {
        plat.count = plat.wait;
        plat.status = PlatStatus.waiting;
        S_StartSound(snd, SFX.sfx_pstop);
      }
      break;
    }
    case PlatStatus.waiting:
      if (!--plat.count) {
        plat.status = plat.sector.floorheight === plat.low ? PlatStatus.up : PlatStatus.down;
        S_StartSound(snd, SFX.sfx_pstart);
      }
      break;
    case PlatStatus.in_stasis:
      break;
  }
}

export function EV_DoPlat(line: Line, type: PlatType, amount: number): boolean {
  let secnum = -1;
  let rtn = false;
  if (type === PlatType.perpetualRaise) P_ActivateInStasis(line.tag);
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    const sec = lv.sectors[secnum];
    if (sec.specialdata) continue;
    rtn = true;
    const plat = new Plat();
    P_AddThinker(plat);
    plat.type = type;
    plat.sector = sec;
    sec.specialdata = plat;
    plat.func = T_PlatRaise;
    plat.crush = false;
    plat.tag = line.tag;
    switch (type) {
      case PlatType.raiseToNearestAndChange:
        plat.speed = PLATSPEED / 2;
        sec.floorpic = lv.sides[line.sidenum[0]].sector.floorpic;
        plat.high = P_FindNextHighestFloor(sec, sec.floorheight);
        plat.wait = 0;
        plat.status = PlatStatus.up;
        sec.special = 0;
        S_StartSound(sec.soundorg, SFX.sfx_stnmov);
        break;
      case PlatType.raiseAndChange:
        plat.speed = PLATSPEED / 2;
        sec.floorpic = lv.sides[line.sidenum[0]].sector.floorpic;
        plat.high = (sec.floorheight + amount * FRACUNIT) | 0;
        plat.wait = 0;
        plat.status = PlatStatus.up;
        S_StartSound(sec.soundorg, SFX.sfx_stnmov);
        break;
      case PlatType.downWaitUpStay:
      case PlatType.blazeDWUS:
        plat.speed = type === PlatType.blazeDWUS ? PLATSPEED * 8 : PLATSPEED * 4;
        plat.low = P_FindLowestFloorSurrounding(sec);
        if (plat.low > sec.floorheight) plat.low = sec.floorheight;
        plat.high = sec.floorheight;
        plat.wait = 35 * PLATWAIT;
        plat.status = PlatStatus.down;
        S_StartSound(sec.soundorg, SFX.sfx_pstart);
        break;
      case PlatType.perpetualRaise:
        plat.speed = PLATSPEED;
        plat.low = P_FindLowestFloorSurrounding(sec);
        if (plat.low > sec.floorheight) plat.low = sec.floorheight;
        plat.high = P_FindHighestFloorSurrounding(sec);
        if (plat.high < sec.floorheight) plat.high = sec.floorheight;
        plat.wait = 35 * PLATWAIT;
        plat.status = (P_Random() & 1) as PlatStatus;
        S_StartSound(sec.soundorg, SFX.sfx_pstart);
        break;
    }
    P_AddActivePlat(plat);
  }
  return rtn;
}

function P_ActivateInStasis(tag: number): void {
  for (const p of activeplats) {
    if (p && p.tag === tag && p.status === PlatStatus.in_stasis) {
      p.status = p.oldstatus;
      p.func = T_PlatRaise;
    }
  }
}

export function EV_StopPlat(line: Line): void {
  for (const p of activeplats) {
    if (p && p.status !== PlatStatus.in_stasis && p.tag === line.tag) {
      p.oldstatus = p.status;
      p.status = PlatStatus.in_stasis;
      p.func = null;
    }
  }
}

export function P_AddActivePlat(plat: Plat): void {
  for (let i = 0; i < MAXPLATS; i++) {
    if (activeplats[i] === null) {
      activeplats[i] = plat;
      return;
    }
  }
  throw new Error('P_AddActivePlat: no more plats!');
}

export function P_RemoveActivePlat(plat: Plat): void {
  for (let i = 0; i < MAXPLATS; i++) {
    if (plat === activeplats[i]) {
      plat.sector.specialdata = null;
      P_RemoveThinker(plat);
      activeplats[i] = null;
      return;
    }
  }
  throw new Error("P_RemoveActivePlat: can't find plat!");
}

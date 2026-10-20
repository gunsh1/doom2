// p_ceilng.c — moving ceilings and crushers.
import { FRACUNIT } from '../core/fixed';
import { Ceiling, CeilingType, MoveResult, MAXCEILINGS, CEILSPEED, type Line } from '../doom/defs';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { P_AddThinker, P_RemoveThinker } from './p_tick';
import { T_MovePlane } from './p_floor';
import { P_FindSectorFromLineTag, P_FindHighestCeilingSurrounding } from './p_spec';
import { S_StartSound } from '../sound/s_sound';

export const activeceilings: (Ceiling | null)[] = new Array(MAXCEILINGS).fill(null);

export function clearActiveCeilings(): void {
  activeceilings.fill(null);
}

export function T_MoveCeiling(ceiling: Ceiling): void {
  const snd = ceiling.sector.soundorg;
  switch (ceiling.direction) {
    case 0:
      break;
    case 1: {
      const res = T_MovePlane(ceiling.sector, ceiling.speed, ceiling.topheight, false, 1, ceiling.direction);
      if (!(g.leveltime & 7) && ceiling.type !== CeilingType.silentCrushAndRaise) S_StartSound(snd, SFX.sfx_stnmov);
      if (res === MoveResult.pastdest) {
        switch (ceiling.type) {
          case CeilingType.raiseToHighest:
            P_RemoveActiveCeiling(ceiling);
            break;
          case CeilingType.silentCrushAndRaise:
            S_StartSound(snd, SFX.sfx_pstop);
          // fallthrough
          case CeilingType.fastCrushAndRaise:
          case CeilingType.crushAndRaise:
            ceiling.direction = -1;
            break;
        }
      }
      break;
    }
    case -1: {
      const res = T_MovePlane(ceiling.sector, ceiling.speed, ceiling.bottomheight, ceiling.crush, 1, ceiling.direction);
      if (!(g.leveltime & 7) && ceiling.type !== CeilingType.silentCrushAndRaise) S_StartSound(snd, SFX.sfx_stnmov);
      if (res === MoveResult.pastdest) {
        switch (ceiling.type) {
          case CeilingType.silentCrushAndRaise:
            S_StartSound(snd, SFX.sfx_pstop);
          // fallthrough
          case CeilingType.crushAndRaise:
            ceiling.speed = CEILSPEED;
          // fallthrough
          case CeilingType.fastCrushAndRaise:
            ceiling.direction = 1;
            break;
          case CeilingType.lowerAndCrush:
          case CeilingType.lowerToFloor:
            P_RemoveActiveCeiling(ceiling);
            break;
        }
      } else if (res === MoveResult.crushed) {
        switch (ceiling.type) {
          case CeilingType.silentCrushAndRaise:
          case CeilingType.crushAndRaise:
          case CeilingType.lowerAndCrush:
            ceiling.speed = CEILSPEED / 8;
            break;
        }
      }
      break;
    }
  }
}

export function EV_DoCeiling(line: Line, type: CeilingType): boolean {
  let secnum = -1;
  let rtn = false;
  switch (type) {
    case CeilingType.fastCrushAndRaise:
    case CeilingType.silentCrushAndRaise:
    case CeilingType.crushAndRaise:
      P_ActivateInStasisCeiling(line);
  }
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    const sec = lv.sectors[secnum];
    if (sec.specialdata) continue;
    rtn = true;
    const ceiling = new Ceiling();
    P_AddThinker(ceiling);
    sec.specialdata = ceiling;
    ceiling.func = T_MoveCeiling;
    ceiling.sector = sec;
    ceiling.crush = false;
    switch (type) {
      case CeilingType.fastCrushAndRaise:
        ceiling.crush = true;
        ceiling.topheight = sec.ceilingheight;
        ceiling.bottomheight = (sec.floorheight + 8 * FRACUNIT) | 0;
        ceiling.direction = -1;
        ceiling.speed = CEILSPEED * 2;
        break;
      case CeilingType.silentCrushAndRaise:
      case CeilingType.crushAndRaise:
      case CeilingType.lowerAndCrush:
      case CeilingType.lowerToFloor:
        if (type === CeilingType.silentCrushAndRaise || type === CeilingType.crushAndRaise) {
          ceiling.crush = true;
          ceiling.topheight = sec.ceilingheight;
        }
        ceiling.bottomheight = sec.floorheight;
        if (type !== CeilingType.lowerToFloor) ceiling.bottomheight = (ceiling.bottomheight + 8 * FRACUNIT) | 0;
        ceiling.direction = -1;
        ceiling.speed = CEILSPEED;
        break;
      case CeilingType.raiseToHighest:
        ceiling.topheight = P_FindHighestCeilingSurrounding(sec);
        ceiling.direction = 1;
        ceiling.speed = CEILSPEED;
        break;
    }
    ceiling.tag = sec.tag;
    ceiling.type = type;
    P_AddActiveCeiling(ceiling);
  }
  return rtn;
}

export function P_AddActiveCeiling(c: Ceiling): void {
  for (let i = 0; i < MAXCEILINGS; i++) {
    if (activeceilings[i] === null) {
      activeceilings[i] = c;
      return;
    }
  }
}

function P_RemoveActiveCeiling(c: Ceiling): void {
  for (let i = 0; i < MAXCEILINGS; i++) {
    if (activeceilings[i] === c) {
      c.sector.specialdata = null;
      P_RemoveThinker(c);
      activeceilings[i] = null;
      break;
    }
  }
}

function P_ActivateInStasisCeiling(line: Line): void {
  for (const c of activeceilings) {
    if (c && c.tag === line.tag && c.direction === 0) {
      c.direction = c.olddirection;
      c.func = T_MoveCeiling;
    }
  }
}

export function EV_CeilingCrushStop(line: Line): boolean {
  let rtn = false;
  for (const c of activeceilings) {
    if (c && c.tag === line.tag && c.direction !== 0) {
      c.olddirection = c.direction;
      c.func = null;
      c.direction = 0;
      rtn = true;
    }
  }
  return rtn;
}

// p_doors.c — vertical doors.
import { FRACUNIT } from '../core/fixed';
import { VlDoor, DoorType, MoveResult, Card, VDOORSPEED, VDOORWAIT, type Line, type Mobj, type Sector } from '../doom/defs';
import { T } from '../doom/strings';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { P_AddThinker, P_RemoveThinker } from './p_tick';
import { T_MovePlane } from './p_floor';
import { P_FindSectorFromLineTag, P_FindLowestCeilingSurrounding } from './p_spec';
import { S_StartSound } from '../sound/s_sound';

export function T_VerticalDoor(door: VlDoor): void {
  const snd = door.sector.soundorg;
  switch (door.direction) {
    case 0:
      if (!--door.topcountdown) {
        switch (door.type) {
          case DoorType.blazeRaise:
            door.direction = -1;
            S_StartSound(snd, SFX.sfx_bdcls);
            break;
          case DoorType.normal:
            door.direction = -1;
            S_StartSound(snd, SFX.sfx_dorcls);
            break;
          case DoorType.close30ThenOpen:
            door.direction = 1;
            S_StartSound(snd, SFX.sfx_doropn);
            break;
        }
      }
      break;
    case 2:
      if (!--door.topcountdown) {
        if (door.type === DoorType.raiseIn5Mins) {
          door.direction = 1;
          door.type = DoorType.normal;
          S_StartSound(snd, SFX.sfx_doropn);
        }
      }
      break;
    case -1: {
      const res = T_MovePlane(door.sector, door.speed, door.sector.floorheight, false, 1, door.direction);
      if (res === MoveResult.pastdest) {
        switch (door.type) {
          case DoorType.blazeRaise:
          case DoorType.blazeClose:
            door.sector.specialdata = null;
            P_RemoveThinker(door);
            S_StartSound(snd, SFX.sfx_bdcls);
            break;
          case DoorType.normal:
          case DoorType.close:
            door.sector.specialdata = null;
            P_RemoveThinker(door);
            break;
          case DoorType.close30ThenOpen:
            door.direction = 0;
            door.topcountdown = 35 * 30;
            break;
        }
      } else if (res === MoveResult.crushed) {
        switch (door.type) {
          case DoorType.blazeClose:
          case DoorType.close:
            break;
          default:
            door.direction = 1;
            S_StartSound(snd, SFX.sfx_doropn);
        }
      }
      break;
    }
    case 1: {
      const res = T_MovePlane(door.sector, door.speed, door.topheight, false, 1, door.direction);
      if (res === MoveResult.pastdest) {
        switch (door.type) {
          case DoorType.blazeRaise:
          case DoorType.normal:
            door.direction = 0;
            door.topcountdown = door.topwait;
            break;
          case DoorType.close30ThenOpen:
          case DoorType.blazeOpen:
          case DoorType.open:
            door.sector.specialdata = null;
            P_RemoveThinker(door);
            break;
        }
      }
      break;
    }
  }
}

export function EV_DoLockedDoor(line: Line, type: DoorType, thing: Mobj): boolean {
  const p = thing.player;
  if (!p) return false;
  switch (line.special) {
    case 99:
    case 133:
      if (!p.cards[Card.it_bluecard] && !p.cards[Card.it_blueskull]) {
        p.message = T.PD_BLUEO;
        S_StartSound(null, SFX.sfx_oof);
        return false;
      }
      break;
    case 134:
    case 135:
      if (!p.cards[Card.it_redcard] && !p.cards[Card.it_redskull]) {
        p.message = T.PD_REDO;
        S_StartSound(null, SFX.sfx_oof);
        return false;
      }
      break;
    case 136:
    case 137:
      if (!p.cards[Card.it_yellowcard] && !p.cards[Card.it_yellowskull]) {
        p.message = T.PD_YELLOWO;
        S_StartSound(null, SFX.sfx_oof);
        return false;
      }
      break;
  }
  return EV_DoDoor(line, type);
}

export function EV_DoDoor(line: Line, type: DoorType): boolean {
  let secnum = -1;
  let rtn = false;
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    const sec = lv.sectors[secnum];
    if (sec.specialdata) continue;
    rtn = true;
    const door = new VlDoor();
    P_AddThinker(door);
    sec.specialdata = door;
    door.func = T_VerticalDoor;
    door.sector = sec;
    door.type = type;
    door.topwait = VDOORWAIT;
    door.speed = VDOORSPEED;
    switch (type) {
      case DoorType.blazeClose:
        door.topheight = (P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0;
        door.direction = -1;
        door.speed = VDOORSPEED * 4;
        S_StartSound(sec.soundorg, SFX.sfx_bdcls);
        break;
      case DoorType.close:
        door.topheight = (P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0;
        door.direction = -1;
        S_StartSound(sec.soundorg, SFX.sfx_dorcls);
        break;
      case DoorType.close30ThenOpen:
        door.topheight = sec.ceilingheight;
        door.direction = -1;
        S_StartSound(sec.soundorg, SFX.sfx_dorcls);
        break;
      case DoorType.blazeRaise:
      case DoorType.blazeOpen:
        door.direction = 1;
        door.topheight = (P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0;
        door.speed = VDOORSPEED * 4;
        if (door.topheight !== sec.ceilingheight) S_StartSound(sec.soundorg, SFX.sfx_bdopn);
        break;
      case DoorType.normal:
      case DoorType.open:
        door.direction = 1;
        door.topheight = (P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0;
        if (door.topheight !== sec.ceilingheight) S_StartSound(sec.soundorg, SFX.sfx_doropn);
        break;
    }
  }
  return rtn;
}

export function EV_VerticalDoor(line: Line, thing: Mobj): void {
  const player = thing.player;
  switch (line.special) {
    case 26:
    case 32:
      if (!player) return;
      if (!player.cards[Card.it_bluecard] && !player.cards[Card.it_blueskull]) {
        player.message = T.PD_BLUEK;
        S_StartSound(null, SFX.sfx_oof);
        return;
      }
      break;
    case 27:
    case 34:
      if (!player) return;
      if (!player.cards[Card.it_yellowcard] && !player.cards[Card.it_yellowskull]) {
        player.message = T.PD_YELLOWK;
        S_StartSound(null, SFX.sfx_oof);
        return;
      }
      break;
    case 28:
    case 33:
      if (!player) return;
      if (!player.cards[Card.it_redcard] && !player.cards[Card.it_redskull]) {
        player.message = T.PD_REDK;
        S_StartSound(null, SFX.sfx_oof);
        return;
      }
      break;
  }
  const sideIdx = line.sidenum[1];
  if (sideIdx === -1) return; // vanilla would read garbage here
  const sec = lv.sides[sideIdx].sector;
  if (sec.specialdata) {
    const door = sec.specialdata as VlDoor;
    switch (line.special) {
      case 1:
      case 26:
      case 27:
      case 28:
      case 117:
        if (door.direction === -1) door.direction = 1;
        else {
          if (!thing.player) return;
          door.direction = -1;
        }
        return;
    }
  }
  switch (line.special) {
    case 117:
    case 118:
      S_StartSound(sec.soundorg, SFX.sfx_bdopn);
      break;
    default:
      S_StartSound(sec.soundorg, SFX.sfx_doropn);
      break;
  }
  const door = new VlDoor();
  P_AddThinker(door);
  sec.specialdata = door;
  door.func = T_VerticalDoor;
  door.sector = sec;
  door.direction = 1;
  door.speed = VDOORSPEED;
  door.topwait = VDOORWAIT;
  switch (line.special) {
    case 1:
    case 26:
    case 27:
    case 28:
      door.type = DoorType.normal;
      break;
    case 31:
    case 32:
    case 33:
    case 34:
      door.type = DoorType.open;
      line.special = 0;
      break;
    case 117:
      door.type = DoorType.blazeRaise;
      door.speed = VDOORSPEED * 4;
      break;
    case 118:
      door.type = DoorType.blazeOpen;
      line.special = 0;
      door.speed = VDOORSPEED * 4;
      break;
  }
  door.topheight = (P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0;
}

export function P_SpawnDoorCloseIn30(sec: Sector): void {
  const door = new VlDoor();
  P_AddThinker(door);
  sec.specialdata = door;
  sec.special = 0;
  door.func = T_VerticalDoor;
  door.sector = sec;
  door.direction = 0;
  door.type = DoorType.normal;
  door.speed = VDOORSPEED;
  door.topcountdown = 30 * 35;
}

export function P_SpawnDoorRaiseIn5Mins(sec: Sector, _secnum: number): void {
  const door = new VlDoor();
  P_AddThinker(door);
  sec.specialdata = door;
  sec.special = 0;
  door.func = T_VerticalDoor;
  door.sector = sec;
  door.direction = 2;
  door.type = DoorType.raiseIn5Mins;
  door.speed = VDOORSPEED;
  door.topheight = (P_FindLowestCeilingSurrounding(sec) - 4 * FRACUNIT) | 0;
  door.topwait = VDOORWAIT;
  door.topcountdown = 5 * 60 * 35;
}

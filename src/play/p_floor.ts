// p_floor.c — moving planes, floor movers and stairs.
import { FRACUNIT, MAXINT } from '../core/fixed';
import { ML_TWOSIDED, FloorMove, FloorType, StairType, MoveResult, FLOORSPEED, type Sector, type Line } from '../doom/defs';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { P_AddThinker, P_RemoveThinker } from './p_tick';
import { P_ChangeSector } from './p_map';
import {
  P_FindSectorFromLineTag, P_FindHighestFloorSurrounding, P_FindLowestFloorSurrounding, P_FindLowestCeilingSurrounding,
  P_FindNextHighestFloor,
} from './p_spec';
import { textureheight } from '../render/r_data';
import { S_StartSound } from '../sound/s_sound';

/** Move a floor (floorOrCeiling=0) or ceiling (1) towards dest. */
export function T_MovePlane(sector: Sector, speed: number, dest: number, crush: boolean, floorOrCeiling: number, direction: number): MoveResult {
  let lastpos: number;
  if (floorOrCeiling === 0) {
    if (direction === -1) {
      if (sector.floorheight - speed < dest) {
        lastpos = sector.floorheight;
        sector.floorheight = dest;
        if (P_ChangeSector(sector, crush)) {
          sector.floorheight = lastpos;
          P_ChangeSector(sector, crush);
        }
        return MoveResult.pastdest;
      }
      lastpos = sector.floorheight;
      sector.floorheight = (sector.floorheight - speed) | 0;
      if (P_ChangeSector(sector, crush)) {
        sector.floorheight = lastpos;
        P_ChangeSector(sector, crush);
        return MoveResult.crushed;
      }
    } else if (direction === 1) {
      if (sector.floorheight + speed > dest) {
        lastpos = sector.floorheight;
        sector.floorheight = dest;
        if (P_ChangeSector(sector, crush)) {
          sector.floorheight = lastpos;
          P_ChangeSector(sector, crush);
        }
        return MoveResult.pastdest;
      }
      lastpos = sector.floorheight;
      sector.floorheight = (sector.floorheight + speed) | 0;
      if (P_ChangeSector(sector, crush)) {
        if (crush) return MoveResult.crushed;
        sector.floorheight = lastpos;
        P_ChangeSector(sector, crush);
        return MoveResult.crushed;
      }
    }
  } else {
    if (direction === -1) {
      if (sector.ceilingheight - speed < dest) {
        lastpos = sector.ceilingheight;
        sector.ceilingheight = dest;
        if (P_ChangeSector(sector, crush)) {
          sector.ceilingheight = lastpos;
          P_ChangeSector(sector, crush);
        }
        return MoveResult.pastdest;
      }
      lastpos = sector.ceilingheight;
      sector.ceilingheight = (sector.ceilingheight - speed) | 0;
      if (P_ChangeSector(sector, crush)) {
        if (crush) return MoveResult.crushed;
        sector.ceilingheight = lastpos;
        P_ChangeSector(sector, crush);
        return MoveResult.crushed;
      }
    } else if (direction === 1) {
      if (sector.ceilingheight + speed > dest) {
        lastpos = sector.ceilingheight;
        sector.ceilingheight = dest;
        if (P_ChangeSector(sector, crush)) {
          sector.ceilingheight = lastpos;
          P_ChangeSector(sector, crush);
        }
        return MoveResult.pastdest;
      }
      sector.ceilingheight = (sector.ceilingheight + speed) | 0;
      P_ChangeSector(sector, crush);
    }
  }
  return MoveResult.ok;
}

export function T_MoveFloor(floor: FloorMove): void {
  const res = T_MovePlane(floor.sector, floor.speed, floor.floordestheight, floor.crush, 0, floor.direction);
  if (!(g.leveltime & 7)) S_StartSound(floor.sector.soundorg, SFX.sfx_stnmov);
  if (res === MoveResult.pastdest) {
    floor.sector.specialdata = null;
    if (floor.direction === 1) {
      if (floor.type === FloorType.donutRaise) {
        floor.sector.special = floor.newspecial;
        floor.sector.floorpic = floor.texture;
      }
    } else if (floor.direction === -1) {
      if (floor.type === FloorType.lowerAndChange) {
        floor.sector.special = floor.newspecial;
        floor.sector.floorpic = floor.texture;
      }
    }
    P_RemoveThinker(floor);
    S_StartSound(floor.sector.soundorg, SFX.sfx_pstop);
  }
}

function sideOf(sec: Sector, i: number, side: number) {
  return lv.sides[sec.lines[i].sidenum[side]];
}

export function EV_DoFloor(line: Line, floortype: FloorType): boolean {
  let secnum = -1;
  let rtn = false;
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    let sec = lv.sectors[secnum];
    if (sec.specialdata) continue;
    rtn = true;
    const floor = new FloorMove();
    P_AddThinker(floor);
    sec.specialdata = floor;
    floor.func = T_MoveFloor;
    floor.type = floortype;
    floor.crush = false;
    switch (floortype) {
      case FloorType.lowerFloor:
        floor.direction = -1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = P_FindHighestFloorSurrounding(sec);
        break;
      case FloorType.lowerFloorToLowest:
        floor.direction = -1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = P_FindLowestFloorSurrounding(sec);
        break;
      case FloorType.turboLower:
        floor.direction = -1;
        floor.sector = sec;
        floor.speed = FLOORSPEED * 4;
        floor.floordestheight = P_FindHighestFloorSurrounding(sec);
        if (floor.floordestheight !== sec.floorheight) floor.floordestheight = (floor.floordestheight + 8 * FRACUNIT) | 0;
        break;
      case FloorType.raiseFloorCrush:
      case FloorType.raiseFloor:
        if (floortype === FloorType.raiseFloorCrush) floor.crush = true;
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = P_FindLowestCeilingSurrounding(sec);
        if (floor.floordestheight > sec.ceilingheight) floor.floordestheight = sec.ceilingheight;
        floor.floordestheight = (floor.floordestheight - 8 * FRACUNIT * (floortype === FloorType.raiseFloorCrush ? 1 : 0)) | 0;
        break;
      case FloorType.raiseFloorTurbo:
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED * 4;
        floor.floordestheight = P_FindNextHighestFloor(sec, sec.floorheight);
        break;
      case FloorType.raiseFloorToNearest:
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = P_FindNextHighestFloor(sec, sec.floorheight);
        break;
      case FloorType.raiseFloor24:
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = (floor.sector.floorheight + 24 * FRACUNIT) | 0;
        break;
      case FloorType.raiseFloor512:
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = (floor.sector.floorheight + 512 * FRACUNIT) | 0;
        break;
      case FloorType.raiseFloor24AndChange:
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = (floor.sector.floorheight + 24 * FRACUNIT) | 0;
        sec.floorpic = line.frontsector!.floorpic;
        sec.special = line.frontsector!.special;
        break;
      case FloorType.raiseToTexture: {
        let minsize = MAXINT;
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        for (let i = 0; i < sec.linecount; i++) {
          if (sec.lines[i].flags & ML_TWOSIDED) {
            let side = sideOf(sec, i, 0);
            if (side.bottomtexture >= 0 && textureheight[side.bottomtexture] < minsize) minsize = textureheight[side.bottomtexture];
            side = sideOf(sec, i, 1);
            if (side.bottomtexture >= 0 && textureheight[side.bottomtexture] < minsize) minsize = textureheight[side.bottomtexture];
          }
        }
        floor.floordestheight = (floor.sector.floorheight + minsize) | 0;
        break;
      }
      case FloorType.lowerAndChange: {
        floor.direction = -1;
        floor.sector = sec;
        floor.speed = FLOORSPEED;
        floor.floordestheight = P_FindLowestFloorSurrounding(sec);
        floor.texture = sec.floorpic;
        const base = sec;
        for (let i = 0; i < base.linecount; i++) {
          if (base.lines[i].flags & ML_TWOSIDED) {
            if (sideOf(base, i, 0).sector.id === secnum) sec = sideOf(base, i, 1).sector;
            else sec = sideOf(base, i, 0).sector;
            if (sec.floorheight === floor.floordestheight) {
              floor.texture = sec.floorpic;
              floor.newspecial = sec.special;
              break;
            }
          }
        }
        break;
      }
    }
  }
  return rtn;
}

export function EV_BuildStairs(line: Line, type: StairType): boolean {
  let secnum = -1;
  let rtn = false;
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    let sec = lv.sectors[secnum];
    if (sec.specialdata) continue;
    rtn = true;
    let floor = new FloorMove();
    P_AddThinker(floor);
    sec.specialdata = floor;
    floor.func = T_MoveFloor;
    floor.direction = 1;
    floor.sector = sec;
    let speed: number, stairsize: number;
    if (type === StairType.build8) {
      speed = FLOORSPEED / 4;
      stairsize = 8 * FRACUNIT;
    } else {
      speed = FLOORSPEED * 4;
      stairsize = 16 * FRACUNIT;
    }
    floor.speed = speed;
    let height = (sec.floorheight + stairsize) | 0;
    floor.floordestheight = height;
    const texture = sec.floorpic;
    let ok: boolean;
    do {
      ok = false;
      for (let i = 0; i < sec.linecount; i++) {
        const li = sec.lines[i];
        if (!(li.flags & ML_TWOSIDED)) continue;
        let tsec = li.frontsector!;
        let newsecnum = tsec.id;
        if (secnum !== newsecnum) continue;
        tsec = li.backsector!;
        newsecnum = tsec.id;
        if (tsec.floorpic !== texture) continue;
        height = (height + stairsize) | 0;
        if (tsec.specialdata) continue;
        sec = tsec;
        secnum = newsecnum; // vanilla: the outer tag search continues from here
        floor = new FloorMove();
        P_AddThinker(floor);
        sec.specialdata = floor;
        floor.func = T_MoveFloor;
        floor.direction = 1;
        floor.sector = sec;
        floor.speed = speed;
        floor.floordestheight = height;
        ok = true;
        break;
      }
    } while (ok);
  }
  return rtn;
}

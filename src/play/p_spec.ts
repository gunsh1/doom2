// p_spec.c — animated textures, line/sector specials, special sector effects.
import { FRACUNIT, MAXINT } from '../core/fixed';
import { P_Random } from '../core/random';
import {
  ML_TWOSIDED, Power, CF_GODMODE, MAXBUTTONS, BWhere, DoorType, FloorType, CeilingType, PlatType, StairType,
  FloorMove, FLOORSPEED, FASTDARK, SLOWDARK, type Line, type Sector, type Mobj, type Player, type Button,
} from '../doom/defs';
import { MT } from '../doom/info';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { wad } from '../wad/wad';
import { lv } from './p_setup';
import { P_AddThinker } from './p_tick';
import { P_DamageMobj } from './p_inter';
import { EV_DoDoor, P_SpawnDoorCloseIn30, P_SpawnDoorRaiseIn5Mins } from './p_doors';
import { EV_DoFloor, EV_BuildStairs, T_MoveFloor } from './p_floor';
import { EV_DoCeiling, EV_CeilingCrushStop, clearActiveCeilings } from './p_ceilng';
import { EV_DoPlat, EV_StopPlat, clearActivePlats } from './p_plats';
import {
  EV_LightTurnOn, EV_StartLightStrobing, EV_TurnTagLightsOff, P_SpawnLightFlash, P_SpawnStrobeFlash,
  P_SpawnGlowingLight, P_SpawnFireFlicker,
} from './p_lights';
import { P_ChangeSwitchTexture, buttonlist } from './p_switch';
import { EV_Teleport } from './p_telept';
import { R_CheckTextureNumForName, R_TextureNumForName, R_FlatNumForName, texturetranslation, flattranslation } from '../render/r_data';
import { S_StartSound } from '../sound/s_sound';
import { G_ExitLevel, G_SecretExitLevel } from '../game/g_game';

interface Anim { istexture: boolean; picnum: number; basepic: number; numpics: number; speed: number }

const animdefs: [boolean, string, string, number][] = [
  [false, 'NUKAGE3', 'NUKAGE1', 8], [false, 'FWATER4', 'FWATER1', 8], [false, 'SWATER4', 'SWATER1', 8],
  [false, 'LAVA4', 'LAVA1', 8], [false, 'BLOOD3', 'BLOOD1', 8], [false, 'RROCK08', 'RROCK05', 8],
  [false, 'SLIME04', 'SLIME01', 8], [false, 'SLIME08', 'SLIME05', 8], [false, 'SLIME12', 'SLIME09', 8],
  [true, 'BLODGR4', 'BLODGR1', 8], [true, 'SLADRIP3', 'SLADRIP1', 8], [true, 'BLODRIP4', 'BLODRIP1', 8],
  [true, 'FIREWALL', 'FIREWALA', 8], [true, 'GSTFONT3', 'GSTFONT1', 8], [true, 'FIRELAVA', 'FIRELAV3', 8],
  [true, 'FIREMAG3', 'FIREMAG1', 8], [true, 'FIREBLU2', 'FIREBLU1', 8], [true, 'ROCKRED3', 'ROCKRED1', 8],
  [true, 'BFALL4', 'BFALL1', 8], [true, 'SFALL4', 'SFALL1', 8], [true, 'WFALL4', 'WFALL1', 8],
  [true, 'DBRAIN4', 'DBRAIN1', 8],
];

let anims: Anim[] = [];

export function P_InitPicAnims(): void {
  anims = [];
  for (const [istexture, endname, startname, speed] of animdefs) {
    let picnum: number, basepic: number;
    if (istexture) {
      if (R_CheckTextureNumForName(startname) === -1) continue;
      picnum = R_TextureNumForName(endname);
      basepic = R_TextureNumForName(startname);
    } else {
      if (wad.checkNumForName(startname) === -1) continue;
      picnum = R_FlatNumForName(endname);
      basepic = R_FlatNumForName(startname);
    }
    const numpics = picnum - basepic + 1;
    if (numpics < 2) throw new Error(`P_InitPicAnims: bad cycle from ${startname} to ${endname}`);
    anims.push({ istexture, picnum, basepic, numpics, speed });
  }
}

export function getNextSector(line: Line, sec: Sector): Sector | null {
  if (!(line.flags & ML_TWOSIDED)) return null;
  if (line.frontsector === sec) return line.backsector;
  return line.frontsector;
}

export function P_FindLowestFloorSurrounding(sec: Sector): number {
  let floor = sec.floorheight;
  for (const check of sec.lines) {
    const other = getNextSector(check, sec);
    if (other && other.floorheight < floor) floor = other.floorheight;
  }
  return floor;
}

export function P_FindHighestFloorSurrounding(sec: Sector): number {
  let floor = -500 * FRACUNIT;
  for (const check of sec.lines) {
    const other = getNextSector(check, sec);
    if (other && other.floorheight > floor) floor = other.floorheight;
  }
  return floor;
}

const MAX_ADJOINING_SECTORS = 20;

export function P_FindNextHighestFloor(sec: Sector, currentheight: number): number {
  const heightlist: number[] = [];
  for (const check of sec.lines) {
    const other = getNextSector(check, sec);
    if (!other) continue;
    if (other.floorheight > currentheight) heightlist.push(other.floorheight);
    if (heightlist.length >= MAX_ADJOINING_SECTORS) break;
  }
  if (!heightlist.length) return currentheight;
  let min = heightlist[0];
  for (let i = 1; i < heightlist.length; i++) if (heightlist[i] < min) min = heightlist[i];
  return min;
}

export function P_FindLowestCeilingSurrounding(sec: Sector): number {
  let height = MAXINT;
  for (const check of sec.lines) {
    const other = getNextSector(check, sec);
    if (other && other.ceilingheight < height) height = other.ceilingheight;
  }
  return height;
}

export function P_FindHighestCeilingSurrounding(sec: Sector): number {
  let height = 0;
  for (const check of sec.lines) {
    const other = getNextSector(check, sec);
    if (other && other.ceilingheight > height) height = other.ceilingheight;
  }
  return height;
}

export function P_FindSectorFromLineTag(line: Line, start: number): number {
  for (let i = start + 1; i < lv.sectors.length; i++) if (lv.sectors[i].tag === line.tag) return i;
  return -1;
}

export function P_FindMinSurroundingLight(sector: Sector, max: number): number {
  let min = max;
  for (const line of sector.lines) {
    const check = getNextSector(line, sector);
    if (check && check.lightlevel < min) min = check.lightlevel;
  }
  return min;
}

export function P_CrossSpecialLine(linenum: number, side: number, thing: Mobj): void {
  const line = lv.lines[linenum];
  if (!thing.player) {
    switch (thing.type) {
      case MT.MT_ROCKET:
      case MT.MT_PLASMA:
      case MT.MT_BFG:
      case MT.MT_TROOPSHOT:
      case MT.MT_HEADSHOT:
      case MT.MT_BRUISERSHOT:
        return;
    }
    if (![39, 97, 125, 126, 4, 10, 88].includes(line.special)) return;
  }
  const once = (fn: () => void) => {
    fn();
    line.special = 0;
  };
  switch (line.special) {
    // Trigger once
    case 2: once(() => EV_DoDoor(line, DoorType.open)); break;
    case 3: once(() => EV_DoDoor(line, DoorType.close)); break;
    case 4: once(() => EV_DoDoor(line, DoorType.normal)); break;
    case 5: once(() => EV_DoFloor(line, FloorType.raiseFloor)); break;
    case 6: once(() => EV_DoCeiling(line, CeilingType.fastCrushAndRaise)); break;
    case 8: once(() => EV_BuildStairs(line, StairType.build8)); break;
    case 10: once(() => EV_DoPlat(line, PlatType.downWaitUpStay, 0)); break;
    case 12: once(() => EV_LightTurnOn(line, 0)); break;
    case 13: once(() => EV_LightTurnOn(line, 255)); break;
    case 16: once(() => EV_DoDoor(line, DoorType.close30ThenOpen)); break;
    case 17: once(() => EV_StartLightStrobing(line)); break;
    case 19: once(() => EV_DoFloor(line, FloorType.lowerFloor)); break;
    case 22: once(() => EV_DoPlat(line, PlatType.raiseToNearestAndChange, 0)); break;
    case 25: once(() => EV_DoCeiling(line, CeilingType.crushAndRaise)); break;
    case 30: once(() => EV_DoFloor(line, FloorType.raiseToTexture)); break;
    case 35: once(() => EV_LightTurnOn(line, 35)); break;
    case 36: once(() => EV_DoFloor(line, FloorType.turboLower)); break;
    case 37: once(() => EV_DoFloor(line, FloorType.lowerAndChange)); break;
    case 38: once(() => EV_DoFloor(line, FloorType.lowerFloorToLowest)); break;
    case 39: once(() => EV_Teleport(line, side, thing)); break;
    case 40:
      once(() => {
        EV_DoCeiling(line, CeilingType.raiseToHighest);
        EV_DoFloor(line, FloorType.lowerFloorToLowest);
      });
      break;
    case 44: once(() => EV_DoCeiling(line, CeilingType.lowerAndCrush)); break;
    case 52: G_ExitLevel(); break;
    case 53: once(() => EV_DoPlat(line, PlatType.perpetualRaise, 0)); break;
    case 54: once(() => EV_StopPlat(line)); break;
    case 56: once(() => EV_DoFloor(line, FloorType.raiseFloorCrush)); break;
    case 57: once(() => EV_CeilingCrushStop(line)); break;
    case 58: once(() => EV_DoFloor(line, FloorType.raiseFloor24)); break;
    case 59: once(() => EV_DoFloor(line, FloorType.raiseFloor24AndChange)); break;
    case 104: once(() => EV_TurnTagLightsOff(line)); break;
    case 108: once(() => EV_DoDoor(line, DoorType.blazeRaise)); break;
    case 109: once(() => EV_DoDoor(line, DoorType.blazeOpen)); break;
    case 100: once(() => EV_BuildStairs(line, StairType.turbo16)); break;
    case 110: once(() => EV_DoDoor(line, DoorType.blazeClose)); break;
    case 119: once(() => EV_DoFloor(line, FloorType.raiseFloorToNearest)); break;
    case 121: once(() => EV_DoPlat(line, PlatType.blazeDWUS, 0)); break;
    case 124: G_SecretExitLevel(); break;
    case 125:
      if (!thing.player) once(() => EV_Teleport(line, side, thing));
      break;
    case 130: once(() => EV_DoFloor(line, FloorType.raiseFloorTurbo)); break;
    case 141: once(() => EV_DoCeiling(line, CeilingType.silentCrushAndRaise)); break;
    // Retrigger
    case 72: EV_DoCeiling(line, CeilingType.lowerAndCrush); break;
    case 73: EV_DoCeiling(line, CeilingType.crushAndRaise); break;
    case 74: EV_CeilingCrushStop(line); break;
    case 75: EV_DoDoor(line, DoorType.close); break;
    case 76: EV_DoDoor(line, DoorType.close30ThenOpen); break;
    case 77: EV_DoCeiling(line, CeilingType.fastCrushAndRaise); break;
    case 79: EV_LightTurnOn(line, 35); break;
    case 80: EV_LightTurnOn(line, 0); break;
    case 81: EV_LightTurnOn(line, 255); break;
    case 82: EV_DoFloor(line, FloorType.lowerFloorToLowest); break;
    case 83: EV_DoFloor(line, FloorType.lowerFloor); break;
    case 84: EV_DoFloor(line, FloorType.lowerAndChange); break;
    case 86: EV_DoDoor(line, DoorType.open); break;
    case 87: EV_DoPlat(line, PlatType.perpetualRaise, 0); break;
    case 88: EV_DoPlat(line, PlatType.downWaitUpStay, 0); break;
    case 89: EV_StopPlat(line); break;
    case 90: EV_DoDoor(line, DoorType.normal); break;
    case 91: EV_DoFloor(line, FloorType.raiseFloor); break;
    case 92: EV_DoFloor(line, FloorType.raiseFloor24); break;
    case 93: EV_DoFloor(line, FloorType.raiseFloor24AndChange); break;
    case 94: EV_DoFloor(line, FloorType.raiseFloorCrush); break;
    case 95: EV_DoPlat(line, PlatType.raiseToNearestAndChange, 0); break;
    case 96: EV_DoFloor(line, FloorType.raiseToTexture); break;
    case 97: EV_Teleport(line, side, thing); break;
    case 98: EV_DoFloor(line, FloorType.turboLower); break;
    case 105: EV_DoDoor(line, DoorType.blazeRaise); break;
    case 106: EV_DoDoor(line, DoorType.blazeOpen); break;
    case 107: EV_DoDoor(line, DoorType.blazeClose); break;
    case 120: EV_DoPlat(line, PlatType.blazeDWUS, 0); break;
    case 126:
      if (!thing.player) EV_Teleport(line, side, thing);
      break;
    case 128: EV_DoFloor(line, FloorType.raiseFloorToNearest); break;
    case 129: EV_DoFloor(line, FloorType.raiseFloorTurbo); break;
  }
}

export function P_ShootSpecialLine(thing: Mobj, line: Line): void {
  if (!thing.player && line.special !== 46) return;
  switch (line.special) {
    case 24:
      EV_DoFloor(line, FloorType.raiseFloor);
      P_ChangeSwitchTexture(line, false);
      break;
    case 46:
      EV_DoDoor(line, DoorType.open);
      P_ChangeSwitchTexture(line, true);
      break;
    case 47:
      EV_DoPlat(line, PlatType.raiseToNearestAndChange, 0);
      P_ChangeSwitchTexture(line, false);
      break;
  }
}

export function P_PlayerInSpecialSector(player: Player): void {
  const mo = player.mo!;
  const sector = mo.subsector.sector;
  if (mo.z !== sector.floorheight) return;
  switch (sector.special) {
    case 5:
      if (!player.powers[Power.pw_ironfeet]) if (!(g.leveltime & 0x1f)) P_DamageMobj(mo, null, null, 10);
      break;
    case 7:
      if (!player.powers[Power.pw_ironfeet]) if (!(g.leveltime & 0x1f)) P_DamageMobj(mo, null, null, 5);
      break;
    case 16:
    case 4:
      if (!player.powers[Power.pw_ironfeet] || P_Random() < 5) {
        if (!(g.leveltime & 0x1f)) P_DamageMobj(mo, null, null, 20);
      }
      break;
    case 9:
      player.secretcount++;
      sector.special = 0;
      break;
    case 11:
      player.cheats &= ~CF_GODMODE;
      if (!(g.leveltime & 0x1f)) P_DamageMobj(mo, null, null, 20);
      if (player.health <= 10) G_ExitLevel();
      break;
    default:
      // Vanilla aborts with I_Error on unknown specials; ignore them instead.
      break;
  }
}

let linespeciallist: Line[] = [];

export function P_UpdateSpecials(): void {
  for (const anim of anims) {
    for (let i = anim.basepic; i < anim.basepic + anim.numpics; i++) {
      const pic = anim.basepic + ((((g.leveltime / anim.speed) | 0) + i) % anim.numpics);
      if (anim.istexture) texturetranslation[i] = pic;
      else flattranslation[i] = pic;
    }
  }
  for (const line of linespeciallist) {
    if (line.special === 48) lv.sides[line.sidenum[0]].textureoffset = (lv.sides[line.sidenum[0]].textureoffset + FRACUNIT) | 0;
  }
  for (let i = 0; i < MAXBUTTONS; i++) {
    const b = buttonlist[i];
    if (b.btimer) {
      b.btimer--;
      if (!b.btimer) {
        const side = lv.sides[b.line!.sidenum[0]];
        switch (b.where) {
          case BWhere.top: side.toptexture = b.btexture; break;
          case BWhere.middle: side.midtexture = b.btexture; break;
          case BWhere.bottom: side.bottomtexture = b.btexture; break;
        }
        S_StartSound(b.soundorg, SFX.sfx_swtchn);
        clearButton(b);
      }
    }
  }
}

export function clearButton(b: Button): void {
  b.line = null;
  b.where = BWhere.top;
  b.btexture = 0;
  b.btimer = 0;
  b.soundorg = null;
}

export function EV_DoDonut(line: Line): boolean {
  let secnum = -1;
  let rtn = false;
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    const s1 = lv.sectors[secnum];
    if (s1.specialdata) continue;
    rtn = true;
    const s2 = getNextSector(s1.lines[0], s1);
    if (!s2) continue;
    for (let i = 0; i < s2.linecount; i++) {
      // Vanilla tests (!flags & ML_TWOSIDED), which is always 0; only the backsector check matters.
      if (s2.lines[i].backsector === s1) continue;
      const s3 = s2.lines[i].backsector;
      if (!s3) continue;
      let floor = new FloorMove();
      P_AddThinker(floor);
      s2.specialdata = floor;
      floor.func = T_MoveFloor;
      floor.type = FloorType.donutRaise;
      floor.crush = false;
      floor.direction = 1;
      floor.sector = s2;
      floor.speed = FLOORSPEED / 2;
      floor.texture = s3.floorpic;
      floor.newspecial = 0;
      floor.floordestheight = s3.floorheight;

      floor = new FloorMove();
      P_AddThinker(floor);
      s1.specialdata = floor;
      floor.func = T_MoveFloor;
      floor.type = FloorType.lowerFloor;
      floor.crush = false;
      floor.direction = -1;
      floor.sector = s1;
      floor.speed = FLOORSPEED / 2;
      floor.floordestheight = s3.floorheight;
      break;
    }
  }
  return rtn;
}

export function P_SpawnSpecials(): void {
  for (let i = 0; i < lv.sectors.length; i++) {
    const sector = lv.sectors[i];
    if (!sector.special) continue;
    switch (sector.special) {
      case 1: P_SpawnLightFlash(sector); break;
      case 2: P_SpawnStrobeFlash(sector, FASTDARK, 0); break;
      case 3: P_SpawnStrobeFlash(sector, SLOWDARK, 0); break;
      case 4:
        P_SpawnStrobeFlash(sector, FASTDARK, 0);
        sector.special = 4;
        break;
      case 8: P_SpawnGlowingLight(sector); break;
      case 9: g.totalsecret++; break;
      case 10: P_SpawnDoorCloseIn30(sector); break;
      case 12: P_SpawnStrobeFlash(sector, SLOWDARK, 1); break;
      case 13: P_SpawnStrobeFlash(sector, FASTDARK, 1); break;
      case 14: P_SpawnDoorRaiseIn5Mins(sector, i); break;
      case 17: P_SpawnFireFlicker(sector); break;
    }
  }
  linespeciallist = lv.lines.filter((l) => l.special === 48);
  clearActiveCeilings();
  clearActivePlats();
  for (const b of buttonlist) clearButton(b);
}

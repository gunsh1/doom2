// p_switch.c — switch textures, buttons, and "use" line specials.
import {
  ML_SECRET, MAXBUTTONS, BUTTONTIME, BWhere, DoorType, FloorType, CeilingType, PlatType, StairType, GameMode,
  type Line, type Mobj, type Button,
} from '../doom/defs';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { EV_VerticalDoor, EV_DoDoor, EV_DoLockedDoor } from './p_doors';
import { EV_DoFloor, EV_BuildStairs } from './p_floor';
import { EV_DoCeiling } from './p_ceilng';
import { EV_DoPlat } from './p_plats';
import { EV_LightTurnOn } from './p_lights';
import { EV_DoDonut } from './p_spec';
import { R_TextureNumForName } from '../render/r_data';
import { S_StartSound } from '../sound/s_sound';
import { G_ExitLevel, G_SecretExitLevel } from '../game/g_game';

const alphSwitchList: [string, string, number][] = [
  ['SW1BRCOM', 'SW2BRCOM', 1], ['SW1BRN1', 'SW2BRN1', 1], ['SW1BRN2', 'SW2BRN2', 1], ['SW1BRNGN', 'SW2BRNGN', 1],
  ['SW1BROWN', 'SW2BROWN', 1], ['SW1COMM', 'SW2COMM', 1], ['SW1COMP', 'SW2COMP', 1], ['SW1DIRT', 'SW2DIRT', 1],
  ['SW1EXIT', 'SW2EXIT', 1], ['SW1GRAY', 'SW2GRAY', 1], ['SW1GRAY1', 'SW2GRAY1', 1], ['SW1METAL', 'SW2METAL', 1],
  ['SW1PIPE', 'SW2PIPE', 1], ['SW1SLAD', 'SW2SLAD', 1], ['SW1STARG', 'SW2STARG', 1], ['SW1STON1', 'SW2STON1', 1],
  ['SW1STON2', 'SW2STON2', 1], ['SW1STONE', 'SW2STONE', 1], ['SW1STRTN', 'SW2STRTN', 1],
  ['SW1BLUE', 'SW2BLUE', 2], ['SW1CMT', 'SW2CMT', 2], ['SW1GARG', 'SW2GARG', 2], ['SW1GSTON', 'SW2GSTON', 2],
  ['SW1HOT', 'SW2HOT', 2], ['SW1LION', 'SW2LION', 2], ['SW1SATYR', 'SW2SATYR', 2], ['SW1SKIN', 'SW2SKIN', 2],
  ['SW1VINE', 'SW2VINE', 2], ['SW1WOOD', 'SW2WOOD', 2],
  ['SW1PANEL', 'SW2PANEL', 3], ['SW1ROCK', 'SW2ROCK', 3], ['SW1MET2', 'SW2MET2', 3], ['SW1WDMET', 'SW2WDMET', 3],
  ['SW1BRIK', 'SW2BRIK', 3], ['SW1MOD1', 'SW2MOD1', 3], ['SW1ZIM', 'SW2ZIM', 3], ['SW1STON6', 'SW2STON6', 3],
  ['SW1TEK', 'SW2TEK', 3], ['SW1MARB', 'SW2MARB', 3], ['SW1SKULL', 'SW2SKULL', 3],
];

let switchlist: number[] = [];

export const buttonlist: Button[] = Array.from({ length: MAXBUTTONS }, () => ({ line: null, where: BWhere.top, btexture: 0, btimer: 0, soundorg: null }));

export function P_InitSwitchList(): void {
  let episode = 1;
  if (g.gamemode === GameMode.registered || g.gamemode === GameMode.retail) episode = 2;
  else if (g.gamemode === GameMode.commercial) episode = 3;
  switchlist = [];
  for (const [n1, n2, ep] of alphSwitchList) {
    if (ep <= episode) switchlist.push(R_TextureNumForName(n1), R_TextureNumForName(n2));
  }
}

function P_StartButton(line: Line, w: BWhere, texture: number, time: number): void {
  for (const b of buttonlist) if (b.btimer && b.line === line) return;
  for (const b of buttonlist) {
    if (!b.btimer) {
      b.line = line;
      b.where = w;
      b.btexture = texture;
      b.btimer = time;
      b.soundorg = line.frontsector!.soundorg;
      return;
    }
  }
  throw new Error('P_StartButton: no button slots left!');
}

export function P_ChangeSwitchTexture(line: Line, useAgain: boolean): void {
  if (!useAgain) line.special = 0;
  const side = lv.sides[line.sidenum[0]];
  const texTop = side.toptexture;
  const texMid = side.midtexture;
  const texBot = side.bottomtexture;
  let sound = SFX.sfx_swtchn;
  if (line.special === 11) sound = SFX.sfx_swtchx;
  // Vanilla plays the sound at buttonlist[0]'s origin (usually none, i.e. full volume).
  const origin = buttonlist[0].soundorg;
  for (let i = 0; i < switchlist.length; i++) {
    if (switchlist[i] === texTop) {
      S_StartSound(origin, sound);
      side.toptexture = switchlist[i ^ 1];
      if (useAgain) P_StartButton(line, BWhere.top, switchlist[i], BUTTONTIME);
      return;
    } else if (switchlist[i] === texMid) {
      S_StartSound(origin, sound);
      side.midtexture = switchlist[i ^ 1];
      if (useAgain) P_StartButton(line, BWhere.middle, switchlist[i], BUTTONTIME);
      return;
    } else if (switchlist[i] === texBot) {
      S_StartSound(origin, sound);
      side.bottomtexture = switchlist[i ^ 1];
      if (useAgain) P_StartButton(line, BWhere.bottom, switchlist[i], BUTTONTIME);
      return;
    }
  }
}

export function P_UseSpecialLine(thing: Mobj, line: Line, side: number): boolean {
  if (side && line.special !== 124) return false;
  if (!thing.player) {
    if (line.flags & ML_SECRET) return false;
    switch (line.special) {
      case 1:
      case 32:
      case 33:
      case 34:
        break;
      default:
        return false;
    }
  }
  const sw = (ok: boolean, again: boolean) => {
    if (ok) P_ChangeSwitchTexture(line, again);
  };
  switch (line.special) {
    case 1: case 26: case 27: case 28: case 31: case 32: case 33: case 34: case 117: case 118:
      EV_VerticalDoor(line, thing);
      break;
    // Switches, once
    case 7: sw(EV_BuildStairs(line, StairType.build8), false); break;
    case 9: sw(EV_DoDonut(line), false); break;
    case 11:
      P_ChangeSwitchTexture(line, false);
      G_ExitLevel();
      break;
    case 14: sw(EV_DoPlat(line, PlatType.raiseAndChange, 32), false); break;
    case 15: sw(EV_DoPlat(line, PlatType.raiseAndChange, 24), false); break;
    case 18: sw(EV_DoFloor(line, FloorType.raiseFloorToNearest), false); break;
    case 20: sw(EV_DoPlat(line, PlatType.raiseToNearestAndChange, 0), false); break;
    case 21: sw(EV_DoPlat(line, PlatType.downWaitUpStay, 0), false); break;
    case 23: sw(EV_DoFloor(line, FloorType.lowerFloorToLowest), false); break;
    case 29: sw(EV_DoDoor(line, DoorType.normal), false); break;
    case 41: sw(EV_DoCeiling(line, CeilingType.lowerToFloor), false); break;
    case 71: sw(EV_DoFloor(line, FloorType.turboLower), false); break;
    case 49: sw(EV_DoCeiling(line, CeilingType.crushAndRaise), false); break;
    case 50: sw(EV_DoDoor(line, DoorType.close), false); break;
    case 51:
      P_ChangeSwitchTexture(line, false);
      G_SecretExitLevel();
      break;
    case 55: sw(EV_DoFloor(line, FloorType.raiseFloorCrush), false); break;
    case 101: sw(EV_DoFloor(line, FloorType.raiseFloor), false); break;
    case 102: sw(EV_DoFloor(line, FloorType.lowerFloor), false); break;
    case 103: sw(EV_DoDoor(line, DoorType.open), false); break;
    case 111: sw(EV_DoDoor(line, DoorType.blazeRaise), false); break;
    case 112: sw(EV_DoDoor(line, DoorType.blazeOpen), false); break;
    case 113: sw(EV_DoDoor(line, DoorType.blazeClose), false); break;
    case 122: sw(EV_DoPlat(line, PlatType.blazeDWUS, 0), false); break;
    case 127: sw(EV_BuildStairs(line, StairType.turbo16), false); break;
    case 131: sw(EV_DoFloor(line, FloorType.raiseFloorTurbo), false); break;
    case 133: case 135: case 137: sw(EV_DoLockedDoor(line, DoorType.blazeOpen, thing), false); break;
    case 140: sw(EV_DoFloor(line, FloorType.raiseFloor512), false); break;
    // Buttons, repeatable
    case 42: sw(EV_DoDoor(line, DoorType.close), true); break;
    case 43: sw(EV_DoCeiling(line, CeilingType.lowerToFloor), true); break;
    case 45: sw(EV_DoFloor(line, FloorType.lowerFloor), true); break;
    case 60: sw(EV_DoFloor(line, FloorType.lowerFloorToLowest), true); break;
    case 61: sw(EV_DoDoor(line, DoorType.open), true); break;
    case 62: sw(EV_DoPlat(line, PlatType.downWaitUpStay, 1), true); break;
    case 63: sw(EV_DoDoor(line, DoorType.normal), true); break;
    case 64: sw(EV_DoFloor(line, FloorType.raiseFloor), true); break;
    case 66: sw(EV_DoPlat(line, PlatType.raiseAndChange, 24), true); break;
    case 67: sw(EV_DoPlat(line, PlatType.raiseAndChange, 32), true); break;
    case 65: sw(EV_DoFloor(line, FloorType.raiseFloorCrush), true); break;
    case 68: sw(EV_DoPlat(line, PlatType.raiseToNearestAndChange, 0), true); break;
    case 69: sw(EV_DoFloor(line, FloorType.raiseFloorToNearest), true); break;
    case 70: sw(EV_DoFloor(line, FloorType.turboLower), true); break;
    case 114: sw(EV_DoDoor(line, DoorType.blazeRaise), true); break;
    case 115: sw(EV_DoDoor(line, DoorType.blazeOpen), true); break;
    case 116: sw(EV_DoDoor(line, DoorType.blazeClose), true); break;
    case 123: sw(EV_DoPlat(line, PlatType.blazeDWUS, 0), true); break;
    case 132: sw(EV_DoFloor(line, FloorType.raiseFloorTurbo), true); break;
    case 99: case 134: case 136: sw(EV_DoLockedDoor(line, DoorType.blazeOpen, thing), true); break;
    case 138:
      EV_LightTurnOn(line, 255);
      P_ChangeSwitchTexture(line, true);
      break;
    case 139:
      EV_LightTurnOn(line, 35);
      P_ChangeSwitchTexture(line, true);
      break;
  }
  return true;
}

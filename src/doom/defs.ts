// Core data structures and constants (doomdef.h, doomdata.h, r_defs.h, p_mobj.h, d_player.h, p_spec.h, d_think.h).
import { FRACUNIT, MININT, MAXINT } from '../core/fixed';
import type { MobjInfo, State } from './info';

export const SCREENWIDTH_BASE = 320;
export const SCREENHEIGHT_BASE = 200;
export const MAXPLAYERS = 4;
export const TICRATE = 35;

export const enum GameMode { shareware, registered, commercial, retail, indetermined }
export const enum GameState { GS_LEVEL, GS_INTERMISSION, GS_FINALE, GS_DEMOSCREEN, GS_WIPE = -1 }
export const enum GameAction { ga_nothing, ga_loadlevel, ga_newgame, ga_loadgame, ga_savegame, ga_playdemo, ga_completed, ga_victory, ga_worlddone, ga_screenshot }
export const enum Skill { sk_baby, sk_easy, sk_medium, sk_hard, sk_nightmare }

export const MTF_EASY = 1, MTF_NORMAL = 2, MTF_HARD = 4, MTF_AMBUSH = 8;

export const enum Card { it_bluecard, it_yellowcard, it_redcard, it_blueskull, it_yellowskull, it_redskull, NUMCARDS }
export const enum Weapon { wp_fist, wp_pistol, wp_shotgun, wp_chaingun, wp_missile, wp_plasma, wp_bfg, wp_chainsaw, wp_supershotgun, NUMWEAPONS, wp_nochange }
export const enum Ammo { am_clip, am_shell, am_cell, am_misl, NUMAMMO, am_noammo }
export const enum Power { pw_invulnerability, pw_strength, pw_invisibility, pw_ironfeet, pw_allmap, pw_infrared, NUMPOWERS }
export const INVULNTICS = 30 * TICRATE, INVISTICS = 60 * TICRATE, INFRATICS = 120 * TICRATE, IRONTICS = 60 * TICRATE;

// Key codes (doomdef.h); printable keys use their lowercase ASCII code.
export const KEY_RIGHTARROW = 0xae, KEY_LEFTARROW = 0xac, KEY_UPARROW = 0xad, KEY_DOWNARROW = 0xaf;
export const KEY_ESCAPE = 27, KEY_ENTER = 13, KEY_TAB = 9, KEY_BACKSPACE = 127, KEY_PAUSE = 0xff;
export const KEY_F1 = 0x80 + 0x3b, KEY_F2 = 0x80 + 0x3c, KEY_F3 = 0x80 + 0x3d, KEY_F4 = 0x80 + 0x3e, KEY_F5 = 0x80 + 0x3f;
export const KEY_F6 = 0x80 + 0x40, KEY_F7 = 0x80 + 0x41, KEY_F8 = 0x80 + 0x42, KEY_F9 = 0x80 + 0x43, KEY_F10 = 0x80 + 0x44;
export const KEY_F11 = 0x80 + 0x57, KEY_F12 = 0x80 + 0x58;
export const KEY_EQUALS = 0x3d, KEY_MINUS = 0x2d;
export const KEY_RSHIFT = 0x80 + 0x36, KEY_RCTRL = 0x80 + 0x1d, KEY_RALT = 0x80 + 0x38;

// ---- p_local.h ----
export const FLOATSPEED = FRACUNIT * 4;
export const MAXHEALTH = 100;
export const VIEWHEIGHT = 41 * FRACUNIT;
export const MAPBLOCKUNITS = 128;
export const MAPBLOCKSIZE = MAPBLOCKUNITS * FRACUNIT;
export const MAPBLOCKSHIFT = 16 + 7;
export const MAPBMASK = MAPBLOCKSIZE - 1;
export const MAPBTOFRAC = MAPBLOCKSHIFT - 16;
export const PLAYERRADIUS = 16 * FRACUNIT;
export const MAXRADIUS = 32 * FRACUNIT;
export const GRAVITY = FRACUNIT;
export const MAXMOVE = 30 * FRACUNIT;
export const USERANGE = 64 * FRACUNIT;
export const MELEERANGE = 64 * FRACUNIT;
export const MISSILERANGE = 32 * 64 * FRACUNIT;
export const BASETHRESHOLD = 100;
export const ONFLOORZ = MININT;
export const ONCEILINGZ = MAXINT;
export const ITEMQUESIZE = 128;
export const MAXINTERCEPTS = 128;
export const PT_ADDLINES = 1, PT_ADDTHINGS = 2, PT_EARLYOUT = 4;

// ---- doomdata.h ----
export const ML_BLOCKING = 1, ML_BLOCKMONSTERS = 2, ML_TWOSIDED = 4, ML_DONTPEGTOP = 8, ML_DONTPEGBOTTOM = 16;
export const ML_SECRET = 32, ML_SOUNDBLOCK = 64, ML_DONTDRAW = 128, ML_MAPPED = 256;
export const NF_SUBSECTOR = 0x8000;

// ---- p_mobj.h flags ----
export const MF_SPECIAL = 1, MF_SOLID = 2, MF_SHOOTABLE = 4, MF_NOSECTOR = 8, MF_NOBLOCKMAP = 16, MF_AMBUSH = 32;
export const MF_JUSTHIT = 64, MF_JUSTATTACKED = 128, MF_SPAWNCEILING = 256, MF_NOGRAVITY = 512, MF_DROPOFF = 0x400;
export const MF_PICKUP = 0x800, MF_NOCLIP = 0x1000, MF_SLIDE = 0x2000, MF_FLOAT = 0x4000, MF_TELEPORT = 0x8000;
export const MF_MISSILE = 0x10000, MF_DROPPED = 0x20000, MF_SHADOW = 0x40000, MF_NOBLOOD = 0x80000, MF_CORPSE = 0x100000;
export const MF_INFLOAT = 0x200000, MF_COUNTKILL = 0x400000, MF_COUNTITEM = 0x800000, MF_SKULLFLY = 0x1000000;
export const MF_NOTDMATCH = 0x2000000, MF_TRANSLATION = 0xc000000, MF_TRANSSHIFT = 26;

export const FF_FULLBRIGHT = 0x8000;
export const FF_FRAMEMASK = 0x7fff;

// ---- thinkers (d_think.h) ----
export type ThinkFn = (t: any) => void;
/** Marker meaning "remove this thinker on next P_RunThinkers" (vanilla uses function == -1). */
export const THINKER_REMOVED: ThinkFn = () => {};

export class Thinker {
  prev: Thinker = this;
  next: Thinker = this;
  func: ThinkFn | null = null;
}

// ---- map geometry (r_defs.h) ----
export interface Vertex { x: number; y: number }

export class DegenMobj { x = 0; y = 0; z = 0 }

export class Sector {
  id = 0;
  floorheight = 0;
  ceilingheight = 0;
  floorpic = 0;
  ceilingpic = 0;
  lightlevel = 0;
  special = 0;
  tag = 0;
  soundtraversed = 0;
  soundtarget: Mobj | null = null;
  blockbox = [0, 0, 0, 0];
  soundorg = new DegenMobj();
  validcount = 0;
  thinglist: Mobj | null = null;
  specialdata: Thinker | null = null;
  linecount = 0;
  lines: Line[] = [];
}

export class Side {
  textureoffset = 0;
  rowoffset = 0;
  toptexture = 0;
  bottomtexture = 0;
  midtexture = 0;
  sector!: Sector;
}

export const enum SlopeType { ST_HORIZONTAL, ST_VERTICAL, ST_POSITIVE, ST_NEGATIVE }

export class Line {
  id = 0;
  v1!: Vertex;
  v2!: Vertex;
  dx = 0;
  dy = 0;
  flags = 0;
  special = 0;
  tag = 0;
  sidenum: [number, number] = [-1, -1];
  bbox = [0, 0, 0, 0];
  slopetype = SlopeType.ST_HORIZONTAL;
  frontsector: Sector | null = null;
  backsector: Sector | null = null;
  validcount = 0;
  specialdata: Thinker | null = null;
}

export interface Subsector { sector: Sector; numlines: number; firstline: number }

export interface Seg {
  v1: Vertex;
  v2: Vertex;
  offset: number;
  angle: number;
  sidedef: Side;
  linedef: Line;
  frontsector: Sector;
  backsector: Sector | null;
}

export interface Node {
  x: number;
  y: number;
  dx: number;
  dy: number;
  bbox: [number[], number[]];
  children: [number, number];
}

export const BOXTOP = 0, BOXBOTTOM = 1, BOXLEFT = 2, BOXRIGHT = 3;

export interface MapThing { x: number; y: number; angle: number; type: number; options: number }

// ---- mobj (p_mobj.h) ----
export class Mobj extends Thinker {
  x = 0;
  y = 0;
  z = 0;
  snext: Mobj | null = null;
  sprev: Mobj | null = null;
  angle = 0;
  sprite = 0;
  frame = 0;
  bnext: Mobj | null = null;
  bprev: Mobj | null = null;
  subsector!: Subsector;
  floorz = 0;
  ceilingz = 0;
  radius = 0;
  height = 0;
  momx = 0;
  momy = 0;
  momz = 0;
  validcount = 0;
  type = 0;
  info!: MobjInfo;
  tics = 0;
  state!: State;
  flags = 0;
  health = 0;
  movedir = 0;
  movecount = 0;
  target: Mobj | null = null;
  reactiontime = 0;
  threshold = 0;
  player: Player | null = null;
  lastlook = 0;
  spawnpoint: MapThing = { x: 0, y: 0, angle: 0, type: 0, options: 0 };
  tracer: Mobj | null = null;
}

// ---- ticcmd (d_ticcmd.h) ----
export class TicCmd {
  forwardmove = 0; // signed char
  sidemove = 0; // signed char
  angleturn = 0; // short
  consistancy = 0; // short
  chatchar = 0;
  buttons = 0;
  copyFrom(o: TicCmd): void {
    this.forwardmove = o.forwardmove;
    this.sidemove = o.sidemove;
    this.angleturn = o.angleturn;
    this.consistancy = o.consistancy;
    this.chatchar = o.chatchar;
    this.buttons = o.buttons;
  }
  clear(): void {
    this.forwardmove = this.sidemove = this.angleturn = this.consistancy = this.chatchar = this.buttons = 0;
  }
}

// d_event.h buttons
export const BT_ATTACK = 1, BT_USE = 2, BT_SPECIAL = 128, BT_SPECIALMASK = 3, BT_CHANGE = 4;
export const BT_WEAPONMASK = 8 + 16 + 32, BT_WEAPONSHIFT = 3;
export const BTS_PAUSE = 1, BTS_SAVEGAME = 2, BTS_SAVEMASK = 4 + 8 + 16, BTS_SAVESHIFT = 2;

// ---- player (d_player.h) ----
export const enum PlayerState { PST_LIVE, PST_DEAD, PST_REBORN }
export const CF_NOCLIP = 1, CF_GODMODE = 2, CF_NOMOMENTUM = 4;

export const enum PsprNum { ps_weapon, ps_flash, NUMPSPRITES }
export class PspDef {
  state: State | null = null;
  tics = 0;
  sx = 0;
  sy = 0;
}

export class Player {
  mo: Mobj | null = null;
  playerstate = PlayerState.PST_LIVE;
  cmd = new TicCmd();
  viewz = 0;
  viewheight = 0;
  deltaviewheight = 0;
  bob = 0;
  health = 0;
  armorpoints = 0;
  armortype = 0;
  powers = new Array<number>(Power.NUMPOWERS).fill(0);
  cards = new Array<boolean>(Card.NUMCARDS).fill(false);
  backpack = false;
  frags = new Array<number>(MAXPLAYERS).fill(0);
  readyweapon = Weapon.wp_fist;
  pendingweapon = Weapon.wp_fist;
  weaponowned = new Array<boolean>(Weapon.NUMWEAPONS).fill(false);
  ammo = new Array<number>(Ammo.NUMAMMO).fill(0);
  maxammo = new Array<number>(Ammo.NUMAMMO).fill(0);
  attackdown = false;
  usedown = false;
  cheats = 0;
  refire = 0;
  killcount = 0;
  itemcount = 0;
  secretcount = 0;
  message: string | null = null;
  damagecount = 0;
  bonuscount = 0;
  attacker: Mobj | null = null;
  extralight = 0;
  fixedcolormap = 0;
  colormap = 0;
  psprites: PspDef[] = [new PspDef(), new PspDef()];
  didsecret = false;
}

export interface WbPlayer { in: boolean; skills: number; sitems: number; ssecret: number; stime: number; frags: number[]; score: number }
export interface WbStart {
  epsd: number;
  didsecret: boolean;
  last: number;
  next: number;
  maxkills: number;
  maxitems: number;
  maxsecret: number;
  maxfrags: number;
  partime: number;
  pnum: number;
  plyr: WbPlayer[];
}

// ---- special thinkers (p_spec.h) ----
export class FireFlicker extends Thinker { sector!: Sector; count = 0; maxlight = 0; minlight = 0 }
export class LightFlash extends Thinker { sector!: Sector; count = 0; maxlight = 0; minlight = 0; maxtime = 0; mintime = 0 }
export class Strobe extends Thinker { sector!: Sector; count = 0; minlight = 0; maxlight = 0; darktime = 0; brighttime = 0 }
export class Glow extends Thinker { sector!: Sector; minlight = 0; maxlight = 0; direction = 0 }
export const GLOWSPEED = 8, STROBEBRIGHT = 5, FASTDARK = 15, SLOWDARK = 35;

export const enum BWhere { top, middle, bottom }
export interface Button { line: Line | null; where: BWhere; btexture: number; btimer: number; soundorg: DegenMobj | null }
export const MAXSWITCHES = 50, MAXBUTTONS = 16, BUTTONTIME = 35;

export const enum PlatStatus { up, down, waiting, in_stasis }
export const enum PlatType { perpetualRaise, downWaitUpStay, raiseAndChange, raiseToNearestAndChange, blazeDWUS }
export class Plat extends Thinker {
  sector!: Sector;
  speed = 0;
  low = 0;
  high = 0;
  wait = 0;
  count = 0;
  status = PlatStatus.up;
  oldstatus = PlatStatus.up;
  crush = false;
  tag = 0;
  type = PlatType.perpetualRaise;
}
export const PLATWAIT = 3, PLATSPEED = FRACUNIT, MAXPLATS = 30;

export const enum DoorType { normal, close30ThenOpen, close, open, raiseIn5Mins, blazeRaise, blazeOpen, blazeClose }
export class VlDoor extends Thinker {
  type = DoorType.normal;
  sector!: Sector;
  topheight = 0;
  speed = 0;
  direction = 0;
  topwait = 0;
  topcountdown = 0;
}
export const VDOORSPEED = FRACUNIT * 2, VDOORWAIT = 150;

export const enum CeilingType { lowerToFloor, raiseToHighest, lowerAndCrush, crushAndRaise, fastCrushAndRaise, silentCrushAndRaise }
export class Ceiling extends Thinker {
  type = CeilingType.lowerToFloor;
  sector!: Sector;
  bottomheight = 0;
  topheight = 0;
  speed = 0;
  crush = false;
  direction = 0;
  tag = 0;
  olddirection = 0;
}
export const CEILSPEED = FRACUNIT, CEILWAIT = 150, MAXCEILINGS = 30;

export const enum FloorType {
  lowerFloor, lowerFloorToLowest, turboLower, raiseFloor, raiseFloorToNearest, raiseToTexture, lowerAndChange,
  raiseFloor24, raiseFloor24AndChange, raiseFloorCrush, raiseFloorTurbo, donutRaise, raiseFloor512,
}
export const enum StairType { build8, turbo16 }
export class FloorMove extends Thinker {
  type = FloorType.lowerFloor;
  crush = false;
  sector!: Sector;
  direction = 0;
  newspecial = 0;
  texture = 0;
  floordestheight = 0;
  speed = 0;
}
export const FLOORSPEED = FRACUNIT;
export const enum MoveResult { ok, crushed, pastdest }

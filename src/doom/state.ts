// doomstat.c / g_game.c globals shared across modules.
import {
  GameMode, GameState, GameAction, Skill, MAXPLAYERS, Player, type MapThing, type WbStart,
} from './defs';

export const MAX_DM_STARTS = 10;

function newWbStart(): WbStart {
  return {
    epsd: 0, didsecret: false, last: 0, next: 0, maxkills: 0, maxitems: 0, maxsecret: 0, maxfrags: 0, partime: 0, pnum: 0,
    plyr: Array.from({ length: MAXPLAYERS }, () => ({ in: false, skills: 0, sitems: 0, ssecret: 0, stime: 0, frags: [0, 0, 0, 0], score: 0 })),
  };
}

export const g = {
  // command-line style parameters
  nomonsters: false,
  respawnparm: false,
  fastparm: false,
  devparm: false,
  gamemode: GameMode.indetermined as GameMode,
  /** Freedoom IWAD detected (affects nothing in gameplay, only labels). */
  isFreedoom: false,
  modifiedgame: false,

  startskill: Skill.sk_medium as Skill,
  startepisode: 1,
  startmap: 1,
  autostart: false,

  gameskill: Skill.sk_medium as Skill,
  gameepisode: 1,
  gamemap: 1,
  respawnmonsters: false,
  netgame: false,
  deathmatch: 0,

  snd_SfxVolume: 8,
  snd_MusicVolume: 8,

  statusbaractive: true,
  automapactive: false,
  menuactive: false,
  paused: false,
  viewactive: true,
  nodrawers: false,

  viewangleoffset: 0,
  consoleplayer: 0,
  displayplayer: 0,
  totalkills: 0,
  totalitems: 0,
  totalsecret: 0,
  levelstarttic: 0,
  leveltime: 0,
  usergame: false,
  demoplayback: false,
  demorecording: false,
  netdemo: false,
  singledemo: false,
  timingdemo: false,

  gamestate: GameState.GS_DEMOSCREEN as GameState,
  gameaction: GameAction.ga_nothing as GameAction,
  gametic: 0,
  players: Array.from({ length: MAXPLAYERS }, () => new Player()),
  playeringame: [true, false, false, false],
  deathmatchstarts: [] as MapThing[],
  playerstarts: Array.from({ length: MAXPLAYERS }, (): MapThing => ({ x: 0, y: 0, angle: 0, type: 0, options: 0 })),
  wminfo: newWbStart(),
  maxammo: [200, 50, 300, 50] as number[],
  precache: true,
  wipegamestate: GameState.GS_DEMOSCREEN as GameState,
  mouseSensitivity: 5,
  bodyqueslot: 0,
  skyflatnum: 0,
  skytexture: 0,
  validcount: 1,
};


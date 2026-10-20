// p_setup.c — load a map from the WAD into the level structures.
import { FRACBITS, FixedDiv, MININT, MAXINT } from '../core/fixed';
import { wad, readName } from '../wad/wad';
import {
  Sector, Side, Line, SlopeType, BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT, ML_TWOSIDED, MAXRADIUS, MAPBLOCKSHIFT,
  GameMode, MAXPLAYERS, type Vertex, type Seg, type Subsector, type Node, type Mobj, type MapThing, type Skill,
} from '../doom/defs';
import { g } from '../doom/state';
import { R_FlatNumForName, R_TextureNumForName } from '../render/r_data';
import { P_InitThinkers } from './p_tick';
import { P_SpawnMapThing, resetItemQueue } from './p_mobj';
import { P_SpawnSpecials, P_InitPicAnims } from './p_spec';
import { P_InitSwitchList } from './p_switch';
import { S_Start } from '../sound/s_sound';
import { G_DeathMatchSpawnPlayer } from '../game/g_game';
import { R_InitSprites } from '../render/r_things';

const ML_THINGS = 1, ML_LINEDEFS = 2, ML_SIDEDEFS = 3, ML_VERTEXES = 4, ML_SEGS = 5, ML_SSECTORS = 6;
const ML_NODES = 7, ML_SECTORS = 8, ML_REJECT = 9, ML_BLOCKMAP = 10;

/** Current level data. Replaced wholesale on each P_SetupLevel. */
export const lv = {
  vertexes: [] as Vertex[],
  segs: [] as Seg[],
  sectors: [] as Sector[],
  subsectors: [] as Subsector[],
  nodes: [] as Node[],
  lines: [] as Line[],
  sides: [] as Side[],
  bmapwidth: 0,
  bmapheight: 0,
  /** Whole BLOCKMAP lump as signed shorts; blockmap offsets index into this. */
  blockmaplump: new Int16Array(0),
  /** Offset of the block offset table (blockmaplump index 4). */
  blockmap: 4,
  bmaporgx: 0,
  bmaporgy: 0,
  blocklinks: [] as (Mobj | null)[],
  rejectmatrix: new Uint8Array(0),
};

export function M_ClearBox(box: number[]): void {
  box[BOXTOP] = box[BOXRIGHT] = MININT;
  box[BOXBOTTOM] = box[BOXLEFT] = MAXINT;
}

export function M_AddToBox(box: number[], x: number, y: number): void {
  if (x < box[BOXLEFT]) box[BOXLEFT] = x;
  else if (x > box[BOXRIGHT]) box[BOXRIGHT] = x;
  if (y < box[BOXBOTTOM]) box[BOXBOTTOM] = y;
  else if (y > box[BOXTOP]) box[BOXTOP] = y;
}

function loadVertexes(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 4 | 0;
  lv.vertexes = [];
  for (let i = 0; i < n; i++) lv.vertexes.push({ x: d.getInt16(i * 4, true) << FRACBITS, y: d.getInt16(i * 4 + 2, true) << FRACBITS });
}

function loadSegs(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 12 | 0;
  lv.segs = [];
  for (let i = 0; i < n; i++) {
    const p = i * 12;
    const ldef = lv.lines[d.getInt16(p + 6, true)];
    const side = d.getInt16(p + 8, true);
    const sidedef = lv.sides[ldef.sidenum[side]];
    lv.segs.push({
      v1: lv.vertexes[d.getInt16(p, true)],
      v2: lv.vertexes[d.getInt16(p + 2, true)],
      angle: (d.getInt16(p + 4, true) << 16) >>> 0,
      offset: d.getInt16(p + 10, true) << 16,
      linedef: ldef,
      sidedef,
      frontsector: sidedef.sector,
      backsector: ldef.flags & ML_TWOSIDED ? lv.sides[ldef.sidenum[side ^ 1]]?.sector ?? null : null,
    });
  }
}

function loadSubsectors(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 4 | 0;
  lv.subsectors = [];
  for (let i = 0; i < n; i++) {
    lv.subsectors.push({ sector: null as unknown as Sector, numlines: d.getInt16(i * 4, true), firstline: d.getInt16(i * 4 + 2, true) });
  }
}

function loadSectors(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 26 | 0;
  lv.sectors = [];
  for (let i = 0; i < n; i++) {
    const p = i * 26;
    const s = new Sector();
    s.id = i;
    s.floorheight = d.getInt16(p, true) << FRACBITS;
    s.ceilingheight = d.getInt16(p + 2, true) << FRACBITS;
    s.floorpic = R_FlatNumForName(readName(d, p + 4));
    s.ceilingpic = R_FlatNumForName(readName(d, p + 12));
    s.lightlevel = d.getInt16(p + 20, true);
    s.special = d.getInt16(p + 22, true);
    s.tag = d.getInt16(p + 24, true);
    lv.sectors.push(s);
  }
}

function loadNodes(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 28 | 0;
  lv.nodes = [];
  for (let i = 0; i < n; i++) {
    const p = i * 28;
    const bbox: [number[], number[]] = [[], []];
    for (let j = 0; j < 2; j++) for (let k = 0; k < 4; k++) bbox[j][k] = d.getInt16(p + 8 + j * 8 + k * 2, true) << FRACBITS;
    lv.nodes.push({
      x: d.getInt16(p, true) << FRACBITS,
      y: d.getInt16(p + 2, true) << FRACBITS,
      dx: d.getInt16(p + 4, true) << FRACBITS,
      dy: d.getInt16(p + 6, true) << FRACBITS,
      bbox,
      children: [d.getUint16(p + 24, true), d.getUint16(p + 26, true)],
    });
  }
}

function loadThings(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 10 | 0;
  for (let i = 0; i < n; i++) {
    const p = i * 10;
    const mt: MapThing = {
      x: d.getInt16(p, true), y: d.getInt16(p + 2, true), angle: d.getInt16(p + 4, true),
      type: d.getInt16(p + 6, true), options: d.getInt16(p + 8, true),
    };
    if (g.gamemode !== GameMode.commercial) {
      // Doom II monsters abort spawning of all remaining things (vanilla behaviour).
      if ([68, 64, 88, 89, 69, 67, 71, 65, 66, 84].includes(mt.type)) break;
    }
    P_SpawnMapThing(mt);
  }
}

function loadLineDefs(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 14 | 0;
  lv.lines = [];
  for (let i = 0; i < n; i++) {
    const p = i * 14;
    const ld = new Line();
    ld.id = i;
    ld.flags = d.getInt16(p + 4, true);
    ld.special = d.getInt16(p + 6, true);
    ld.tag = d.getInt16(p + 8, true);
    const v1 = (ld.v1 = lv.vertexes[d.getUint16(p, true)]);
    const v2 = (ld.v2 = lv.vertexes[d.getUint16(p + 2, true)]);
    ld.dx = (v2.x - v1.x) | 0;
    ld.dy = (v2.y - v1.y) | 0;
    if (!ld.dx) ld.slopetype = SlopeType.ST_VERTICAL;
    else if (!ld.dy) ld.slopetype = SlopeType.ST_HORIZONTAL;
    else ld.slopetype = FixedDiv(ld.dy, ld.dx) > 0 ? SlopeType.ST_POSITIVE : SlopeType.ST_NEGATIVE;
    if (v1.x < v2.x) { ld.bbox[BOXLEFT] = v1.x; ld.bbox[BOXRIGHT] = v2.x; } else { ld.bbox[BOXLEFT] = v2.x; ld.bbox[BOXRIGHT] = v1.x; }
    if (v1.y < v2.y) { ld.bbox[BOXBOTTOM] = v1.y; ld.bbox[BOXTOP] = v2.y; } else { ld.bbox[BOXBOTTOM] = v2.y; ld.bbox[BOXTOP] = v1.y; }
    ld.sidenum = [d.getInt16(p + 10, true), d.getInt16(p + 12, true)];
    ld.frontsector = ld.sidenum[0] !== -1 ? lv.sides[ld.sidenum[0]].sector : null;
    ld.backsector = ld.sidenum[1] !== -1 ? lv.sides[ld.sidenum[1]].sector : null;
    lv.lines.push(ld);
  }
}

function loadSideDefs(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const n = d.byteLength / 30 | 0;
  lv.sides = [];
  for (let i = 0; i < n; i++) {
    const p = i * 30;
    const sd = new Side();
    sd.textureoffset = d.getInt16(p, true) << FRACBITS;
    sd.rowoffset = d.getInt16(p + 2, true) << FRACBITS;
    sd.toptexture = R_TextureNumForName(readName(d, p + 4));
    sd.bottomtexture = R_TextureNumForName(readName(d, p + 12));
    sd.midtexture = R_TextureNumForName(readName(d, p + 20));
    sd.sector = lv.sectors[d.getInt16(p + 28, true)];
    lv.sides.push(sd);
  }
}

function loadBlockMap(lump: number): void {
  const d = wad.cacheLumpNum(lump);
  const count = d.byteLength / 2 | 0;
  const bm = new Int16Array(count);
  for (let i = 0; i < count; i++) bm[i] = d.getInt16(i * 2, true);
  lv.blockmaplump = bm;
  lv.blockmap = 4;
  lv.bmaporgx = bm[0] << FRACBITS;
  lv.bmaporgy = bm[1] << FRACBITS;
  lv.bmapwidth = bm[2];
  lv.bmapheight = bm[3];
  lv.blocklinks = new Array(lv.bmapwidth * lv.bmapheight).fill(null);
}

function groupLines(): void {
  for (const ss of lv.subsectors) ss.sector = lv.segs[ss.firstline].sidedef.sector;
  for (const li of lv.lines) {
    li.frontsector!.linecount++;
    if (li.backsector && li.backsector !== li.frontsector) li.backsector.linecount++;
  }
  const bbox = [0, 0, 0, 0];
  for (const sector of lv.sectors) {
    M_ClearBox(bbox);
    sector.lines = [];
    for (const li of lv.lines) {
      if (li.frontsector === sector || li.backsector === sector) {
        sector.lines.push(li);
        M_AddToBox(bbox, li.v1.x, li.v1.y);
        M_AddToBox(bbox, li.v2.x, li.v2.y);
      }
    }
    if (sector.lines.length !== sector.linecount) throw new Error('P_GroupLines: miscounted');
    sector.soundorg.x = Math.trunc(((bbox[BOXRIGHT] + bbox[BOXLEFT]) | 0) / 2);
    sector.soundorg.y = Math.trunc(((bbox[BOXTOP] + bbox[BOXBOTTOM]) | 0) / 2);
    let block = ((bbox[BOXTOP] - lv.bmaporgy + MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
    sector.blockbox[BOXTOP] = block >= lv.bmapheight ? lv.bmapheight - 1 : block;
    block = ((bbox[BOXBOTTOM] - lv.bmaporgy - MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
    sector.blockbox[BOXBOTTOM] = block < 0 ? 0 : block;
    block = ((bbox[BOXRIGHT] - lv.bmaporgx + MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
    sector.blockbox[BOXRIGHT] = block >= lv.bmapwidth ? lv.bmapwidth - 1 : block;
    block = ((bbox[BOXLEFT] - lv.bmaporgx - MAXRADIUS) | 0) >> MAPBLOCKSHIFT;
    sector.blockbox[BOXLEFT] = block < 0 ? 0 : block;
  }
}

/** REJECT may be short or missing in some WADs; pad like Chocolate Doom (zeros = visible). */
function loadReject(lump: number): void {
  const need = Math.ceil((lv.sectors.length * lv.sectors.length) / 8);
  const src = wad.bytesNum(lump);
  if (src.length >= need) lv.rejectmatrix = src;
  else {
    lv.rejectmatrix = new Uint8Array(need);
    lv.rejectmatrix.set(src);
  }
}

export function mapLumpName(episode: number, map: number): string {
  if (g.gamemode === GameMode.commercial) return map < 10 ? `MAP0${map}` : `MAP${map}`;
  return `E${episode}M${map}`;
}

export function P_SetupLevel(episode: number, map: number, _playermask: number, _skill: Skill): void {
  g.totalkills = g.totalitems = g.totalsecret = g.wminfo.maxfrags = 0;
  g.wminfo.partime = 180;
  for (let i = 0; i < MAXPLAYERS; i++) g.players[i].killcount = g.players[i].secretcount = g.players[i].itemcount = 0;
  g.players[g.consoleplayer].viewz = 1;
  S_Start();
  P_InitThinkers();

  const lumpnum = wad.getNumForName(mapLumpName(episode, map));
  g.leveltime = 0;
  loadBlockMap(lumpnum + ML_BLOCKMAP);
  loadVertexes(lumpnum + ML_VERTEXES);
  loadSectors(lumpnum + ML_SECTORS);
  loadSideDefs(lumpnum + ML_SIDEDEFS);
  loadLineDefs(lumpnum + ML_LINEDEFS);
  loadSubsectors(lumpnum + ML_SSECTORS);
  loadNodes(lumpnum + ML_NODES);
  loadSegs(lumpnum + ML_SEGS);
  loadReject(lumpnum + ML_REJECT);
  groupLines();

  g.bodyqueslot = 0;
  g.deathmatchstarts = [];
  loadThings(lumpnum + ML_THINGS);

  if (g.deathmatch) {
    for (let i = 0; i < MAXPLAYERS; i++) {
      if (g.playeringame[i]) {
        g.players[i].mo = null;
        G_DeathMatchSpawnPlayer(i);
      }
    }
  }
  resetItemQueue();
  P_SpawnSpecials();
}

export function P_Init(): void {
  P_InitSwitchList();
  P_InitPicAnims();
  R_InitSprites();
}

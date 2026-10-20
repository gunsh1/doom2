// r_data.c — texture composition, flats, sprite lump metadata, colormaps.
import { FRACBITS } from '../core/fixed';
import { wad, readName } from '../wad/wad';

export interface TexPatch { originx: number; originy: number; patch: number }
export interface Texture { name: string; width: number; height: number; patches: TexPatch[] }

export let firstflat = 0;
export let lastflat = 0;
export let numflats = 0;
export let firstspritelump = 0;
export let lastspritelump = 0;
export let numspritelumps = 0;
export let numtextures = 0;
export let textures: Texture[] = [];
export let texturewidthmask: Int32Array;
export let textureheight: Int32Array;
let texturecompositesize: Int32Array;
let texturecolumnlump: Int16Array[];
let texturecolumnofs: Uint16Array[];
let texturecomposite: (Uint8Array | null)[];
export let flattranslation: Int32Array;
export let texturetranslation: Int32Array;
export let spritewidth: Int32Array;
export let spriteoffset: Int32Array;
export let spritetopoffset: Int32Array;
/** 34 colormaps of 256 bytes each (32 light levels, invulnerability, all-black). */
export let colormaps: Uint8Array;

// Patch header accessors (patch_t).
export function patchWidth(p: DataView): number { return p.getInt16(0, true); }
export function patchHeight(p: DataView): number { return p.getInt16(2, true); }
export function patchLeft(p: DataView): number { return p.getInt16(4, true); }
export function patchTop(p: DataView): number { return p.getInt16(6, true); }
export function patchColOfs(p: DataView, x: number): number { return p.getInt32(8 + x * 4, true); }

function drawColumnInCache(patch: Uint8Array, pofs: number, cache: Uint8Array, cacheofs: number, originy: number, cacheheight: number): void {
  while (pofs < patch.length && patch[pofs] !== 0xff) {
    let count = patch[pofs + 1];
    let position = originy + patch[pofs];
    const src = pofs + 3;
    if (position < 0) {
      // Vanilla shortens the run but does not skip the clipped source pixels.
      count += position;
      position = 0;
    }
    if (position + count > cacheheight) count = cacheheight - position;
    for (let i = 0; i < count; i++) cache[cacheofs + position + i] = patch[src + i] ?? 0;
    pofs += patch[pofs + 1] + 4;
  }
}

function generateComposite(texnum: number): Uint8Array {
  const texture = textures[texnum];
  const block = new Uint8Array(Math.max(1, texturecompositesize[texnum]));
  const collump = texturecolumnlump[texnum];
  const colofs = texturecolumnofs[texnum];
  for (const patch of texture.patches) {
    const realpatch = wad.cacheLumpNum(patch.patch);
    const bytes = wad.bytesNum(patch.patch);
    const x1 = patch.originx;
    let x2 = x1 + patchWidth(realpatch);
    let x = x1 < 0 ? 0 : x1;
    if (x2 > texture.width) x2 = texture.width;
    for (; x < x2; x++) {
      if (collump[x] >= 0) continue;
      drawColumnInCache(bytes, patchColOfs(realpatch, x - x1), block, colofs[x], patch.originy, texture.height);
    }
  }
  texturecomposite[texnum] = block;
  return block;
}

function generateLookup(texnum: number): void {
  const texture = textures[texnum];
  texturecomposite[texnum] = null;
  texturecompositesize[texnum] = 0;
  const collump = texturecolumnlump[texnum];
  const colofs = texturecolumnofs[texnum];
  const patchcount = new Uint8Array(texture.width);
  for (const patch of texture.patches) {
    const realpatch = wad.cacheLumpNum(patch.patch);
    const x1 = patch.originx;
    let x2 = x1 + patchWidth(realpatch);
    let x = x1 < 0 ? 0 : x1;
    if (x2 > texture.width) x2 = texture.width;
    for (; x < x2; x++) {
      patchcount[x]++;
      collump[x] = patch.patch;
      colofs[x] = patchColOfs(realpatch, x - x1) + 3;
    }
  }
  for (let x = 0; x < texture.width; x++) {
    if (!patchcount[x]) {
      console.warn(`R_GenerateLookup: column without a patch (${texture.name})`);
      return;
    }
    if (patchcount[x] > 1) {
      collump[x] = -1;
      colofs[x] = texturecompositesize[texnum];
      if (texturecompositesize[texnum] > 0x10000 - texture.height) throw new Error(`R_GenerateLookup: texture ${texnum} is >64k`);
      texturecompositesize[texnum] += texture.height;
    }
  }
}

/** Offset into the returned buffer of the column fetched by the last R_GetColumn call. */
export let columnofs = 0;

/** R_GetColumn: returns the buffer holding raw column pixels; start offset is in `columnofs`. */
export function R_GetColumn(tex: number, col: number): Uint8Array {
  col &= texturewidthmask[tex];
  const lump = texturecolumnlump[tex][col];
  columnofs = texturecolumnofs[tex][col];
  if (lump > 0) return wad.bytesNum(lump);
  return texturecomposite[tex] ?? generateComposite(tex);
}

function initTextures(): void {
  const names = wad.cacheLumpName('PNAMES');
  const nummappatches = names.getInt32(0, true);
  const patchlookup: number[] = [];
  for (let i = 0; i < nummappatches; i++) patchlookup.push(wad.checkNumForName(readName(names, 4 + i * 8)));

  const lumps = [wad.cacheLumpName('TEXTURE1')];
  if (wad.checkNumForName('TEXTURE2') !== -1) lumps.push(wad.cacheLumpName('TEXTURE2'));
  textures = [];
  for (const maptex of lumps) {
    const count = maptex.getInt32(0, true);
    for (let i = 0; i < count; i++) {
      const offset = maptex.getInt32(4 + i * 4, true);
      if (offset > maptex.byteLength) throw new Error('R_InitTextures: bad texture directory');
      const name = readName(maptex, offset);
      const width = maptex.getInt16(offset + 12, true);
      const height = maptex.getInt16(offset + 14, true);
      const patchcount = maptex.getInt16(offset + 20, true);
      const patches: TexPatch[] = [];
      for (let j = 0; j < patchcount; j++) {
        const p = offset + 22 + j * 10;
        const patch = patchlookup[maptex.getInt16(p + 4, true)];
        if (patch === -1 || patch === undefined) throw new Error(`R_InitTextures: Missing patch in texture ${name}`);
        patches.push({ originx: maptex.getInt16(p, true), originy: maptex.getInt16(p + 2, true), patch });
      }
      textures.push({ name, width, height, patches });
    }
  }
  numtextures = textures.length;
  texturecolumnlump = [];
  texturecolumnofs = [];
  texturecomposite = new Array(numtextures).fill(null);
  texturecompositesize = new Int32Array(numtextures);
  texturewidthmask = new Int32Array(numtextures);
  textureheight = new Int32Array(numtextures);
  for (let i = 0; i < numtextures; i++) {
    const t = textures[i];
    texturecolumnlump.push(new Int16Array(t.width));
    texturecolumnofs.push(new Uint16Array(t.width));
    let j = 1;
    while (j * 2 <= t.width) j <<= 1;
    texturewidthmask[i] = j - 1;
    textureheight[i] = t.height << FRACBITS;
  }
  for (let i = 0; i < numtextures; i++) generateLookup(i);
  texturetranslation = new Int32Array(numtextures + 1);
  for (let i = 0; i < numtextures; i++) texturetranslation[i] = i;
}

function initFlats(): void {
  firstflat = wad.getNumForName('F_START') + 1;
  lastflat = wad.getNumForName('F_END') - 1;
  numflats = lastflat - firstflat + 1;
  flattranslation = new Int32Array(numflats + 1);
  for (let i = 0; i < numflats; i++) flattranslation[i] = i;
}

function initSpriteLumps(): void {
  firstspritelump = wad.getNumForName('S_START') + 1;
  lastspritelump = wad.getNumForName('S_END') - 1;
  numspritelumps = lastspritelump - firstspritelump + 1;
  spritewidth = new Int32Array(numspritelumps);
  spriteoffset = new Int32Array(numspritelumps);
  spritetopoffset = new Int32Array(numspritelumps);
  for (let i = 0; i < numspritelumps; i++) {
    const p = wad.cacheLumpNum(firstspritelump + i);
    if (p.byteLength < 8) continue; // marker lumps inside S_START/S_END
    spritewidth[i] = patchWidth(p) << FRACBITS;
    spriteoffset[i] = patchLeft(p) << FRACBITS;
    spritetopoffset[i] = patchTop(p) << FRACBITS;
  }
}

function initColormaps(): void {
  colormaps = wad.bytesName('COLORMAP');
}

export function R_InitData(): void {
  initTextures();
  initFlats();
  initSpriteLumps();
  initColormaps();
}

export function R_FlatNumForName(name: string): number {
  const i = wad.checkNumForName(name);
  if (i === -1) throw new Error(`R_FlatNumForName: ${name} not found`);
  return i - firstflat;
}

export function R_CheckTextureNumForName(name: string): number {
  if (name[0] === '-') return 0;
  const up = name.toUpperCase();
  for (let i = 0; i < numtextures; i++) if (textures[i].name === up) return i;
  return -1;
}

export function R_TextureNumForName(name: string): number {
  const i = R_CheckTextureNumForName(name);
  if (i === -1) throw new Error(`R_TextureNumForName: ${name} not found`);
  return i;
}

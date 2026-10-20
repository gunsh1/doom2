// v_video.c — 8-bit framebuffers and patch blitting.
// All callers use the original 320x200 coordinate space; in hires mode every
// pixel is drawn as a 2x2 block so the UI keeps its layout.
import { wad } from '../wad/wad';
import { patchWidth, patchTop, patchLeft, patchColOfs } from './r_data';

export const ORIGWIDTH = 320;
export const ORIGHEIGHT = 200;

export let hires = 0;
export let SCREENWIDTH = ORIGWIDTH;
export let SCREENHEIGHT = ORIGHEIGHT;
/** screens[0] is the visible frame; 1 = view border backdrop; 2,3 = wipe; 4 = status bar background. */
export let screens: Uint8Array[] = [];

const resizeListeners: (() => void)[] = [];
export function onVideoResize(fn: () => void): void {
  resizeListeners.push(fn);
}

export function V_SetHires(h: number): void {
  hires = h ? 1 : 0;
  SCREENWIDTH = ORIGWIDTH << hires;
  SCREENHEIGHT = ORIGHEIGHT << hires;
  screens = [0, 1, 2, 3, 4].map(() => new Uint8Array(SCREENWIDTH * SCREENHEIGHT));
  for (const fn of resizeListeners) fn();
}

export function V_Init(): void {
  V_SetHires(hires);
}

/** Draw a patch lump (DataView) at original-resolution coordinates. */
export function V_DrawPatch(x: number, y: number, scrn: number, patch: DataView, flipped = false): void {
  const bytes = new Uint8Array(patch.buffer, patch.byteOffset, patch.byteLength);
  y -= patchTop(patch);
  x -= patchLeft(patch);
  const w = patchWidth(patch);
  const dst = screens[scrn];
  const sw = SCREENWIDTH;
  const sh = SCREENHEIGHT;
  const s = 1 << hires;
  for (let col = 0; col < w; col++) {
    const sx = (x + col) * s;
    if (sx < 0 || sx >= sw) continue;
    let p = patchColOfs(patch, flipped ? w - 1 - col : col);
    while (p < bytes.length && bytes[p] !== 0xff) {
      const top = bytes[p];
      const len = bytes[p + 1];
      let src = p + 3;
      for (let i = 0; i < len; i++, src++) {
        const sy = (y + top + i) * s;
        if (sy < 0 || sy >= sh) continue;
        const c = bytes[src];
        const o = sy * sw + sx;
        dst[o] = c;
        if (s === 2) {
          if (sx + 1 < sw) dst[o + 1] = c;
          if (sy + 1 < sh) {
            dst[o + sw] = c;
            if (sx + 1 < sw) dst[o + sw + 1] = c;
          }
        }
      }
      p += len + 4;
    }
  }
}

export function V_DrawPatchFlipped(x: number, y: number, scrn: number, patch: DataView): void {
  V_DrawPatch(x, y, scrn, patch, true);
}

export function V_DrawPatchName(x: number, y: number, scrn: number, name: string): void {
  V_DrawPatch(x, y, scrn, wad.cacheLumpName(name));
}

/** Copy a rectangle given in original coordinates between screens. */
export function V_CopyRect(srcx: number, srcy: number, srcscrn: number, width: number, height: number, destx: number, desty: number, destscrn: number): void {
  const s = 1 << hires;
  const src = screens[srcscrn];
  const dst = screens[destscrn];
  const sw = SCREENWIDTH;
  for (let row = 0; row < height * s; row++) {
    const so = (srcy * s + row) * sw + srcx * s;
    const dofs = (desty * s + row) * sw + destx * s;
    dst.set(src.subarray(so, so + width * s), dofs);
  }
}

/** Fill a rectangle (original coordinates) with a 64x64 flat, tiled. */
export function V_FillFlat(x: number, y: number, width: number, height: number, scrn: number, flat: Uint8Array): void {
  const s = 1 << hires;
  const dst = screens[scrn];
  const sw = SCREENWIDTH;
  for (let py = y * s; py < (y + height) * s; py++) {
    const fy = ((py / s) | 0) & 63;
    for (let px = x * s; px < (x + width) * s; px++) {
      dst[py * sw + px] = flat[(fy << 6) + (((px / s) | 0) & 63)];
    }
  }
}

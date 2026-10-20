// Trigonometry lookup tables and binary angle constants (tables.h / tables.c).
// Angles are unsigned 32-bit binary angles; keep them normalized with `>>> 0`.
import { finesineData, finetangentData, tantoangleData, gammatableData } from '../generated/tables_data';

export const FINEANGLES = 8192;
export const FINEMASK = FINEANGLES - 1;
export const ANGLETOFINESHIFT = 19;

export const ANG45 = 0x20000000;
export const ANG90 = 0x40000000;
export const ANG180 = 0x80000000;
export const ANG270 = 0xc0000000;
export const ANGLE_MAX = 0xffffffff;
export const ANG1 = (ANG45 / 45) >>> 0;

export const SLOPERANGE = 2048;
export const SLOPEBITS = 11;
export const DBITS = 16 - SLOPEBITS;

export const finesine = finesineData;
/** finecosine[i] = finesine[i + FINEANGLES/4] */
export const finecosine = finesineData.subarray(FINEANGLES / 4);
export const finetangent = finetangentData;
export const tantoangle = tantoangleData;

export const gammatable: Uint8Array[] = [0, 1, 2, 3, 4].map((i) => gammatableData.subarray(i * 256, i * 256 + 256));

export function SlopeDiv(num: number, den: number): number {
  num >>>= 0;
  den >>>= 0;
  if (den < 512) return SLOPERANGE;
  const ans = Math.floor(((num << 3) >>> 0) / (den >>> 8)) >>> 0;
  return ans <= SLOPERANGE ? ans : SLOPERANGE;
}

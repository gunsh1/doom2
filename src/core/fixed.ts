// 16.16 fixed point arithmetic, bit-exact with vanilla m_fixed.c.
export const FRACBITS = 16;
export const FRACUNIT = 1 << FRACBITS;
export const MAXINT = 0x7fffffff;
export const MININT = -0x80000000;
export const MAXSHORT = 0x7fff;
export const MINSHORT = -0x8000;

/** ((int64)a * b) >> 16, truncated to int32. Exact for all int32 inputs. */
export function FixedMul(a: number, b: number): number {
  const ah = a >> 16;
  const al = a & 0xffff;
  const bh = b >> 16;
  const bl = b & 0xffff;
  // a*b = ah*bh<<32 + (ah*bl + al*bh)<<16 + al*bl ; shift right 16 then take low 32 bits.
  return ((Math.imul(ah, bh) << 16) + ah * bl + al * bh + ((al * bl) >>> 16)) | 0;
}

export function FixedDiv(a: number, b: number): number {
  if ((Math.abs(a) | 0) >> 14 >= (Math.abs(b) | 0)) return (a ^ b) < 0 ? MININT : MAXINT;
  return FixedDiv2(a, b);
}

export function FixedDiv2(a: number, b: number): number {
  const c = (a / b) * FRACUNIT;
  if (c >= 2147483648.0 || c < -2147483648.0) throw new Error('FixedDiv: divide by zero');
  return Math.trunc(c) | 0;
}

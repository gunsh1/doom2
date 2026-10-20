// m_random.c — the vanilla pseudo random table. P_Random drives gameplay (demo-synced),
// M_Random is for cosmetic things that must not affect sync.
import { rndtable } from '../generated/tables_data';

let rndindex = 0;
let prndindex = 0;

export function P_Random(): number {
  prndindex = (prndindex + 1) & 0xff;
  return rndtable[prndindex];
}

export function M_Random(): number {
  rndindex = (rndindex + 1) & 0xff;
  return rndtable[rndindex];
}

export function M_ClearRandom(): void {
  rndindex = prndindex = 0;
}

export function P_GetRandomIndex(): number {
  return prndindex;
}

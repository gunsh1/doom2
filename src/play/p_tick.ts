// p_tick.c — thinker list and the per-tic world update.
import { Thinker, THINKER_REMOVED, MAXPLAYERS } from '../doom/defs';
import { g } from '../doom/state';
import { P_PlayerThink } from './p_user';
import { P_UpdateSpecials } from './p_spec';
import { P_RespawnSpecials } from './p_mobj';

export const thinkercap = new Thinker();

export function P_InitThinkers(): void {
  thinkercap.prev = thinkercap.next = thinkercap;
}

export function P_AddThinker(thinker: Thinker): void {
  thinkercap.prev.next = thinker;
  thinker.next = thinkercap;
  thinker.prev = thinkercap.prev;
  thinkercap.prev = thinker;
}

export function P_RemoveThinker(thinker: Thinker): void {
  thinker.func = THINKER_REMOVED;
}

export function P_RunThinkers(): void {
  let current = thinkercap.next;
  while (current !== thinkercap) {
    if (current.func === THINKER_REMOVED) {
      current.next.prev = current.prev;
      current.prev.next = current.next;
    } else if (current.func) {
      current.func(current);
    }
    current = current.next;
  }
}

export function P_Ticker(): void {
  if (g.paused) return;
  if (!g.netgame && g.menuactive && !g.demoplayback && g.players[g.consoleplayer].viewz !== 1) return;
  for (let i = 0; i < MAXPLAYERS; i++) if (g.playeringame[i]) P_PlayerThink(g.players[i]);
  P_RunThinkers();
  P_UpdateSpecials();
  P_RespawnSpecials();
  g.leveltime++;
}

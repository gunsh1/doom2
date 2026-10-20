// p_telept.c — teleporters.
import { ANGLETOFINESHIFT, finesine, finecosine } from '../core/tables';
import { MF_MISSILE, type Line, type Mobj } from '../doom/defs';
import { MT } from '../doom/info';
import { SFX } from '../generated/sounds_data';
import { lv } from './p_setup';
import { thinkercap } from './p_tick';
import { P_MobjThinker, P_SpawnMobj } from './p_mobj';
import { P_TeleportMove } from './p_map';
import { S_StartSound } from '../sound/s_sound';

export function EV_Teleport(line: Line, side: number, thing: Mobj): boolean {
  if (thing.flags & MF_MISSILE) return false;
  if (side === 1) return false;
  const tag = line.tag;
  for (let i = 0; i < lv.sectors.length; i++) {
    if (lv.sectors[i].tag !== tag) continue;
    for (let th = thinkercap.next; th !== thinkercap; th = th.next) {
      if (th.func !== P_MobjThinker) continue;
      const m = th as Mobj;
      if (m.type !== MT.MT_TELEPORTMAN) continue;
      if (m.subsector.sector.id !== i) continue;
      const oldx = thing.x;
      const oldy = thing.y;
      const oldz = thing.z;
      if (!P_TeleportMove(thing, m.x, m.y)) return false;
      thing.z = thing.floorz;
      if (thing.player) thing.player.viewz = (thing.z + thing.player.viewheight) | 0;
      let fog = P_SpawnMobj(oldx, oldy, oldz, MT.MT_TFOG);
      S_StartSound(fog, SFX.sfx_telept);
      const an = m.angle >>> ANGLETOFINESHIFT;
      fog = P_SpawnMobj((m.x + 20 * finecosine[an]) | 0, (m.y + 20 * finesine[an]) | 0, thing.z, MT.MT_TFOG);
      S_StartSound(fog, SFX.sfx_telept);
      if (thing.player) thing.reactiontime = 18;
      thing.angle = m.angle;
      thing.momx = thing.momy = thing.momz = 0;
      return true;
    }
  }
  return false;
}

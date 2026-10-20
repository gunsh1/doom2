// p_user.c — player movement, view bobbing, and per-tic player logic.
import { FRACUNIT, FixedMul } from '../core/fixed';
import { finesine, finecosine, FINEANGLES, FINEMASK, ANG90, ANG180, ANGLETOFINESHIFT } from '../core/tables';
import {
  VIEWHEIGHT, CF_NOMOMENTUM, CF_NOCLIP, MF_NOCLIP, MF_JUSTATTACKED, MF_SHADOW, PlayerState, Weapon, Power, GameMode,
  BT_SPECIAL, BT_CHANGE, BT_WEAPONMASK, BT_WEAPONSHIFT, BT_USE, type Player,
} from '../doom/defs';
import { S, states } from '../doom/info';
import { g } from '../doom/state';
import { P_SetMobjState } from './p_mobj';
import { P_MovePsprites } from './p_pspr';
import { P_UseLines } from './p_map';
import { P_PlayerInSpecialSector } from './p_spec';
import { R_PointToAngle2 } from '../render/renderer';

const INVERSECOLORMAP = 32;
const MAXBOB = 0x100000;
const ANG5 = (ANG90 / 18) >>> 0;

let onground = false;

function P_Thrust(player: Player, angle: number, move: number): void {
  angle >>>= ANGLETOFINESHIFT;
  const mo = player.mo!;
  mo.momx = (mo.momx + FixedMul(move, finecosine[angle])) | 0;
  mo.momy = (mo.momy + FixedMul(move, finesine[angle])) | 0;
}

function P_CalcHeight(player: Player): void {
  const mo = player.mo!;
  player.bob = (FixedMul(mo.momx, mo.momx) + FixedMul(mo.momy, mo.momy)) | 0;
  player.bob >>= 2;
  if (player.bob > MAXBOB) player.bob = MAXBOB;
  if (player.cheats & CF_NOMOMENTUM || !onground) {
    player.viewz = (mo.z + VIEWHEIGHT) | 0;
    if (player.viewz > mo.ceilingz - 4 * FRACUNIT) player.viewz = (mo.ceilingz - 4 * FRACUNIT) | 0;
    player.viewz = (mo.z + player.viewheight) | 0;
    return;
  }
  const angle = ((FINEANGLES / 20) * g.leveltime) & FINEMASK;
  const bob = FixedMul((player.bob / 2) | 0, finesine[angle]);
  if (player.playerstate === PlayerState.PST_LIVE) {
    player.viewheight = (player.viewheight + player.deltaviewheight) | 0;
    if (player.viewheight > VIEWHEIGHT) {
      player.viewheight = VIEWHEIGHT;
      player.deltaviewheight = 0;
    }
    if (player.viewheight < VIEWHEIGHT / 2) {
      player.viewheight = VIEWHEIGHT / 2;
      if (player.deltaviewheight <= 0) player.deltaviewheight = 1;
    }
    if (player.deltaviewheight) {
      player.deltaviewheight = (player.deltaviewheight + FRACUNIT / 4) | 0;
      if (!player.deltaviewheight) player.deltaviewheight = 1;
    }
  }
  player.viewz = (mo.z + player.viewheight + bob) | 0;
  if (player.viewz > mo.ceilingz - 4 * FRACUNIT) player.viewz = (mo.ceilingz - 4 * FRACUNIT) | 0;
}

function P_MovePlayer(player: Player): void {
  const cmd = player.cmd;
  const mo = player.mo!;
  mo.angle = (mo.angle + (cmd.angleturn << 16)) >>> 0;
  onground = mo.z <= mo.floorz;
  if (cmd.forwardmove && onground) P_Thrust(player, mo.angle, cmd.forwardmove * 2048);
  if (cmd.sidemove && onground) P_Thrust(player, (mo.angle - ANG90) >>> 0, cmd.sidemove * 2048);
  if ((cmd.forwardmove || cmd.sidemove) && mo.state === states[S.S_PLAY]) P_SetMobjState(mo, S.S_PLAY_RUN1);
}

function P_DeathThink(player: Player): void {
  P_MovePsprites(player);
  if (player.viewheight > 6 * FRACUNIT) player.viewheight -= FRACUNIT;
  if (player.viewheight < 6 * FRACUNIT) player.viewheight = 6 * FRACUNIT;
  player.deltaviewheight = 0;
  const mo = player.mo!;
  onground = mo.z <= mo.floorz;
  P_CalcHeight(player);
  if (player.attacker && player.attacker !== mo) {
    const angle = R_PointToAngle2(mo.x, mo.y, player.attacker.x, player.attacker.y);
    const delta = (angle - mo.angle) >>> 0;
    if (delta < ANG5 || delta > (-ANG5 >>> 0)) {
      mo.angle = angle;
      if (player.damagecount) player.damagecount--;
    } else if (delta < ANG180) mo.angle = (mo.angle + ANG5) >>> 0;
    else mo.angle = (mo.angle - ANG5) >>> 0;
  } else if (player.damagecount) player.damagecount--;
  if (player.cmd.buttons & BT_USE) player.playerstate = PlayerState.PST_REBORN;
}

export function P_PlayerThink(player: Player): void {
  const mo = player.mo!;
  if (player.cheats & CF_NOCLIP) mo.flags |= MF_NOCLIP;
  else mo.flags &= ~MF_NOCLIP;
  const cmd = player.cmd;
  if (mo.flags & MF_JUSTATTACKED) {
    cmd.angleturn = 0;
    cmd.forwardmove = (0xc800 / 512) | 0;
    cmd.sidemove = 0;
    mo.flags &= ~MF_JUSTATTACKED;
  }
  if (player.playerstate === PlayerState.PST_DEAD) {
    P_DeathThink(player);
    return;
  }
  if (mo.reactiontime) mo.reactiontime--;
  else P_MovePlayer(player);
  P_CalcHeight(player);
  if (mo.subsector.sector.special) P_PlayerInSpecialSector(player);
  if (cmd.buttons & BT_SPECIAL) cmd.buttons = 0;
  if (cmd.buttons & BT_CHANGE) {
    let newweapon = (cmd.buttons & BT_WEAPONMASK) >> BT_WEAPONSHIFT;
    if (newweapon === Weapon.wp_fist && player.weaponowned[Weapon.wp_chainsaw] && !(player.readyweapon === Weapon.wp_chainsaw && player.powers[Power.pw_strength])) {
      newweapon = Weapon.wp_chainsaw;
    }
    if (g.gamemode === GameMode.commercial && newweapon === Weapon.wp_shotgun && player.weaponowned[Weapon.wp_supershotgun] && player.readyweapon !== Weapon.wp_supershotgun) {
      newweapon = Weapon.wp_supershotgun;
    }
    if (player.weaponowned[newweapon] && newweapon !== player.readyweapon) {
      if ((newweapon !== Weapon.wp_plasma && newweapon !== Weapon.wp_bfg) || g.gamemode !== GameMode.shareware) {
        player.pendingweapon = newweapon;
      }
    }
  }
  if (cmd.buttons & BT_USE) {
    if (!player.usedown) {
      P_UseLines(player);
      player.usedown = true;
    }
  } else player.usedown = false;
  P_MovePsprites(player);
  if (player.powers[Power.pw_strength]) player.powers[Power.pw_strength]++;
  if (player.powers[Power.pw_invulnerability]) player.powers[Power.pw_invulnerability]--;
  if (player.powers[Power.pw_invisibility]) if (!--player.powers[Power.pw_invisibility]) mo.flags &= ~MF_SHADOW;
  if (player.powers[Power.pw_infrared]) player.powers[Power.pw_infrared]--;
  if (player.powers[Power.pw_ironfeet]) player.powers[Power.pw_ironfeet]--;
  if (player.damagecount) player.damagecount--;
  if (player.bonuscount) player.bonuscount--;
  const inv = player.powers[Power.pw_invulnerability];
  const ir = player.powers[Power.pw_infrared];
  if (inv) player.fixedcolormap = inv > 4 * 32 || inv & 8 ? INVERSECOLORMAP : 0;
  else if (ir) player.fixedcolormap = ir > 4 * 32 || ir & 8 ? 1 : 0;
  else player.fixedcolormap = 0;
}

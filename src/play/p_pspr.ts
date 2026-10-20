// p_pspr.c + d_items.c — player weapon sprites and weapon action functions.
import { FRACBITS, FRACUNIT, FixedMul } from '../core/fixed';
import { finesine, finecosine, FINEANGLES, FINEMASK, ANG90, ANG180 } from '../core/tables';
import { P_Random } from '../core/random';
import {
  Weapon, Ammo, Power, PlayerState, PsprNum, BT_ATTACK, MF_JUSTATTACKED, MELEERANGE, MISSILERANGE, GameMode,
  type Player, type PspDef, type Mobj,
} from '../doom/defs';
import { S, MT, states, registerActions } from '../doom/info';
import { g } from '../doom/state';
import { SFX } from '../generated/sounds_data';
import { P_SetMobjState, P_SpawnPlayerMissile, P_SpawnMobj } from './p_mobj';
import { P_AimLineAttack, P_LineAttack, mapState } from './p_map';
import { P_NoiseAlert } from './p_enemy';
import { P_DamageMobj } from './p_inter';
import { R_PointToAngle2 } from '../render/renderer';
import { S_StartSound } from '../sound/s_sound';

const LOWERSPEED = FRACUNIT * 6;
const RAISESPEED = FRACUNIT * 6;
const WEAPONBOTTOM = 128 * FRACUNIT;
const WEAPONTOP = 32 * FRACUNIT;
const BFGCELLS = 40;

export interface WeaponInfo { ammo: Ammo; upstate: number; downstate: number; readystate: number; atkstate: number; flashstate: number }

export const weaponinfo: WeaponInfo[] = [
  { ammo: Ammo.am_noammo, upstate: S.S_PUNCHUP, downstate: S.S_PUNCHDOWN, readystate: S.S_PUNCH, atkstate: S.S_PUNCH1, flashstate: S.S_NULL },
  { ammo: Ammo.am_clip, upstate: S.S_PISTOLUP, downstate: S.S_PISTOLDOWN, readystate: S.S_PISTOL, atkstate: S.S_PISTOL1, flashstate: S.S_PISTOLFLASH },
  { ammo: Ammo.am_shell, upstate: S.S_SGUNUP, downstate: S.S_SGUNDOWN, readystate: S.S_SGUN, atkstate: S.S_SGUN1, flashstate: S.S_SGUNFLASH1 },
  { ammo: Ammo.am_clip, upstate: S.S_CHAINUP, downstate: S.S_CHAINDOWN, readystate: S.S_CHAIN, atkstate: S.S_CHAIN1, flashstate: S.S_CHAINFLASH1 },
  { ammo: Ammo.am_misl, upstate: S.S_MISSILEUP, downstate: S.S_MISSILEDOWN, readystate: S.S_MISSILE, atkstate: S.S_MISSILE1, flashstate: S.S_MISSILEFLASH1 },
  { ammo: Ammo.am_cell, upstate: S.S_PLASMAUP, downstate: S.S_PLASMADOWN, readystate: S.S_PLASMA, atkstate: S.S_PLASMA1, flashstate: S.S_PLASMAFLASH1 },
  { ammo: Ammo.am_cell, upstate: S.S_BFGUP, downstate: S.S_BFGDOWN, readystate: S.S_BFG, atkstate: S.S_BFG1, flashstate: S.S_BFGFLASH1 },
  { ammo: Ammo.am_noammo, upstate: S.S_SAWUP, downstate: S.S_SAWDOWN, readystate: S.S_SAW, atkstate: S.S_SAW1, flashstate: S.S_NULL },
  { ammo: Ammo.am_shell, upstate: S.S_DSGUNUP, downstate: S.S_DSGUNDOWN, readystate: S.S_DSGUN, atkstate: S.S_DSGUN1, flashstate: S.S_DSGUNFLASH1 },
];

export function P_SetPsprite(player: Player, position: number, stnum: number): void {
  const psp = player.psprites[position];
  do {
    if (!stnum) {
      psp.state = null;
      break;
    }
    const state = states[stnum];
    psp.state = state;
    psp.tics = state.tics;
    if (state.misc1) {
      psp.sx = state.misc1 << FRACBITS;
      psp.sy = state.misc2 << FRACBITS;
    }
    if (state.action) {
      state.action(player, psp);
      if (!psp.state) break;
    }
    stnum = psp.state!.nextstate;
  } while (!psp.tics);
}

function P_BringUpWeapon(player: Player): void {
  if (player.pendingweapon === Weapon.wp_nochange) player.pendingweapon = player.readyweapon;
  if (player.pendingweapon === Weapon.wp_chainsaw) S_StartSound(player.mo, SFX.sfx_sawup);
  const newstate = weaponinfo[player.pendingweapon].upstate;
  player.pendingweapon = Weapon.wp_nochange;
  player.psprites[PsprNum.ps_weapon].sy = WEAPONBOTTOM;
  P_SetPsprite(player, PsprNum.ps_weapon, newstate);
}

function P_CheckAmmo(player: Player): boolean {
  const ammo = weaponinfo[player.readyweapon].ammo;
  let count: number;
  if (player.readyweapon === Weapon.wp_bfg) count = BFGCELLS;
  else if (player.readyweapon === Weapon.wp_supershotgun) count = 2;
  else count = 1;
  if (ammo === Ammo.am_noammo || player.ammo[ammo] >= count) return true;
  do {
    if (player.weaponowned[Weapon.wp_plasma] && player.ammo[Ammo.am_cell] && g.gamemode !== GameMode.shareware) player.pendingweapon = Weapon.wp_plasma;
    else if (player.weaponowned[Weapon.wp_supershotgun] && player.ammo[Ammo.am_shell] > 2 && g.gamemode === GameMode.commercial) player.pendingweapon = Weapon.wp_supershotgun;
    else if (player.weaponowned[Weapon.wp_chaingun] && player.ammo[Ammo.am_clip]) player.pendingweapon = Weapon.wp_chaingun;
    else if (player.weaponowned[Weapon.wp_shotgun] && player.ammo[Ammo.am_shell]) player.pendingweapon = Weapon.wp_shotgun;
    else if (player.ammo[Ammo.am_clip]) player.pendingweapon = Weapon.wp_pistol;
    else if (player.weaponowned[Weapon.wp_chainsaw]) player.pendingweapon = Weapon.wp_chainsaw;
    else if (player.weaponowned[Weapon.wp_missile] && player.ammo[Ammo.am_misl]) player.pendingweapon = Weapon.wp_missile;
    else if (player.weaponowned[Weapon.wp_bfg] && player.ammo[Ammo.am_cell] > 40 && g.gamemode !== GameMode.shareware) player.pendingweapon = Weapon.wp_bfg;
    else player.pendingweapon = Weapon.wp_fist;
  } while (player.pendingweapon === Weapon.wp_nochange);
  P_SetPsprite(player, PsprNum.ps_weapon, weaponinfo[player.readyweapon].downstate);
  return false;
}

function P_FireWeapon(player: Player): void {
  if (!P_CheckAmmo(player)) return;
  P_SetMobjState(player.mo!, S.S_PLAY_ATK1);
  P_SetPsprite(player, PsprNum.ps_weapon, weaponinfo[player.readyweapon].atkstate);
  P_NoiseAlert(player.mo!, player.mo!);
}

export function P_DropWeapon(player: Player): void {
  P_SetPsprite(player, PsprNum.ps_weapon, weaponinfo[player.readyweapon].downstate);
}

function A_WeaponReady(player: Player, psp: PspDef): void {
  const mo = player.mo!;
  if (mo.state === states[S.S_PLAY_ATK1] || mo.state === states[S.S_PLAY_ATK2]) P_SetMobjState(mo, S.S_PLAY);
  if (player.readyweapon === Weapon.wp_chainsaw && psp.state === states[S.S_SAW]) S_StartSound(mo, SFX.sfx_sawidl);
  if (player.pendingweapon !== Weapon.wp_nochange || !player.health) {
    P_SetPsprite(player, PsprNum.ps_weapon, weaponinfo[player.readyweapon].downstate);
    return;
  }
  if (player.cmd.buttons & BT_ATTACK) {
    if (!player.attackdown || (player.readyweapon !== Weapon.wp_missile && player.readyweapon !== Weapon.wp_bfg)) {
      player.attackdown = true;
      P_FireWeapon(player);
      return;
    }
  } else player.attackdown = false;
  let angle = (128 * g.leveltime) & FINEMASK;
  psp.sx = (FRACUNIT + FixedMul(player.bob, finecosine[angle])) | 0;
  angle &= FINEANGLES / 2 - 1;
  psp.sy = (WEAPONTOP + FixedMul(player.bob, finesine[angle])) | 0;
}

function A_ReFire(player: Player, _psp: PspDef): void {
  if (player.cmd.buttons & BT_ATTACK && player.pendingweapon === Weapon.wp_nochange && player.health) {
    player.refire++;
    P_FireWeapon(player);
  } else {
    player.refire = 0;
    P_CheckAmmo(player);
  }
}

function A_CheckReload(player: Player, _psp: PspDef): void {
  P_CheckAmmo(player);
}

function A_Lower(player: Player, psp: PspDef): void {
  psp.sy = (psp.sy + LOWERSPEED) | 0;
  if (psp.sy < WEAPONBOTTOM) return;
  if (player.playerstate === PlayerState.PST_DEAD) {
    psp.sy = WEAPONBOTTOM;
    return;
  }
  if (!player.health) {
    P_SetPsprite(player, PsprNum.ps_weapon, S.S_NULL);
    return;
  }
  player.readyweapon = player.pendingweapon;
  P_BringUpWeapon(player);
}

function A_Raise(player: Player, psp: PspDef): void {
  psp.sy = (psp.sy - RAISESPEED) | 0;
  if (psp.sy > WEAPONTOP) return;
  psp.sy = WEAPONTOP;
  P_SetPsprite(player, PsprNum.ps_weapon, weaponinfo[player.readyweapon].readystate);
}

function A_GunFlash(player: Player, _psp: PspDef): void {
  P_SetMobjState(player.mo!, S.S_PLAY_ATK2);
  P_SetPsprite(player, PsprNum.ps_flash, weaponinfo[player.readyweapon].flashstate);
}

function A_Punch(player: Player, _psp: PspDef): void {
  let damage = ((P_Random() % 10) + 1) << 1;
  if (player.powers[Power.pw_strength]) damage *= 10;
  let angle = player.mo!.angle;
  angle = (angle + ((P_Random() - P_Random()) << 18)) >>> 0;
  const slope = P_AimLineAttack(player.mo!, angle, MELEERANGE);
  P_LineAttack(player.mo!, angle, MELEERANGE, slope, damage);
  const lt = mapState.linetarget;
  if (lt) {
    S_StartSound(player.mo, SFX.sfx_punch);
    player.mo!.angle = R_PointToAngle2(player.mo!.x, player.mo!.y, lt.x, lt.y);
  }
}

function A_Saw(player: Player, _psp: PspDef): void {
  const mo = player.mo!;
  const damage = 2 * ((P_Random() % 10) + 1);
  let angle = mo.angle;
  angle = (angle + ((P_Random() - P_Random()) << 18)) >>> 0;
  const slope = P_AimLineAttack(mo, angle, MELEERANGE + 1);
  P_LineAttack(mo, angle, MELEERANGE + 1, slope, damage);
  const lt = mapState.linetarget;
  if (!lt) {
    S_StartSound(mo, SFX.sfx_sawful);
    return;
  }
  S_StartSound(mo, SFX.sfx_sawhit);
  angle = R_PointToAngle2(mo.x, mo.y, lt.x, lt.y);
  const d = (angle - mo.angle) >>> 0;
  const a20 = (ANG90 / 20) >>> 0;
  const a21 = (ANG90 / 21) >>> 0;
  if (d > ANG180) {
    if (d < (-a20 >>> 0)) mo.angle = (angle + a21) >>> 0;
    else mo.angle = (mo.angle - a20) >>> 0;
  } else {
    if (d > a20) mo.angle = (angle - a21) >>> 0;
    else mo.angle = (mo.angle + a20) >>> 0;
  }
  mo.flags |= MF_JUSTATTACKED;
}

function A_FireMissile(player: Player, _psp: PspDef): void {
  player.ammo[weaponinfo[player.readyweapon].ammo]--;
  P_SpawnPlayerMissile(player.mo!, MT.MT_ROCKET);
}

function A_FireBFG(player: Player, _psp: PspDef): void {
  player.ammo[weaponinfo[player.readyweapon].ammo] -= BFGCELLS;
  P_SpawnPlayerMissile(player.mo!, MT.MT_BFG);
}

function A_FirePlasma(player: Player, _psp: PspDef): void {
  player.ammo[weaponinfo[player.readyweapon].ammo]--;
  P_SetPsprite(player, PsprNum.ps_flash, weaponinfo[player.readyweapon].flashstate + (P_Random() & 1));
  P_SpawnPlayerMissile(player.mo!, MT.MT_PLASMA);
}

let bulletslope = 0;

function P_BulletSlope(mo: Mobj): void {
  let an = mo.angle;
  bulletslope = P_AimLineAttack(mo, an, 16 * 64 * FRACUNIT);
  if (!mapState.linetarget) {
    an = (an + (1 << 26)) >>> 0;
    bulletslope = P_AimLineAttack(mo, an, 16 * 64 * FRACUNIT);
    if (!mapState.linetarget) {
      an = (an - (2 << 26)) >>> 0;
      bulletslope = P_AimLineAttack(mo, an, 16 * 64 * FRACUNIT);
    }
  }
}

function P_GunShot(mo: Mobj, accurate: boolean): void {
  const damage = 5 * ((P_Random() % 3) + 1);
  let angle = mo.angle;
  if (!accurate) angle = (angle + ((P_Random() - P_Random()) << 18)) >>> 0;
  P_LineAttack(mo, angle, MISSILERANGE, bulletslope, damage);
}

function A_FirePistol(player: Player, _psp: PspDef): void {
  S_StartSound(player.mo, SFX.sfx_pistol);
  P_SetMobjState(player.mo!, S.S_PLAY_ATK2);
  player.ammo[weaponinfo[player.readyweapon].ammo]--;
  P_SetPsprite(player, PsprNum.ps_flash, weaponinfo[player.readyweapon].flashstate);
  P_BulletSlope(player.mo!);
  P_GunShot(player.mo!, !player.refire);
}

function A_FireShotgun(player: Player, _psp: PspDef): void {
  S_StartSound(player.mo, SFX.sfx_shotgn);
  P_SetMobjState(player.mo!, S.S_PLAY_ATK2);
  player.ammo[weaponinfo[player.readyweapon].ammo]--;
  P_SetPsprite(player, PsprNum.ps_flash, weaponinfo[player.readyweapon].flashstate);
  P_BulletSlope(player.mo!);
  for (let i = 0; i < 7; i++) P_GunShot(player.mo!, false);
}

function A_FireShotgun2(player: Player, _psp: PspDef): void {
  S_StartSound(player.mo, SFX.sfx_dshtgn);
  P_SetMobjState(player.mo!, S.S_PLAY_ATK2);
  player.ammo[weaponinfo[player.readyweapon].ammo] -= 2;
  P_SetPsprite(player, PsprNum.ps_flash, weaponinfo[player.readyweapon].flashstate);
  P_BulletSlope(player.mo!);
  for (let i = 0; i < 20; i++) {
    const damage = 5 * ((P_Random() % 3) + 1);
    let angle = player.mo!.angle;
    angle = (angle + ((P_Random() - P_Random()) << 19)) >>> 0;
    P_LineAttack(player.mo!, angle, MISSILERANGE, (bulletslope + ((P_Random() - P_Random()) << 5)) | 0, damage);
  }
}

function A_FireCGun(player: Player, psp: PspDef): void {
  S_StartSound(player.mo, SFX.sfx_pistol);
  if (!player.ammo[weaponinfo[player.readyweapon].ammo]) return;
  P_SetMobjState(player.mo!, S.S_PLAY_ATK2);
  player.ammo[weaponinfo[player.readyweapon].ammo]--;
  P_SetPsprite(player, PsprNum.ps_flash, weaponinfo[player.readyweapon].flashstate + psp.state!.index - S.S_CHAIN1);
  P_BulletSlope(player.mo!);
  P_GunShot(player.mo!, !player.refire);
}

function A_Light0(player: Player): void {
  player.extralight = 0;
}
function A_Light1(player: Player): void {
  player.extralight = 1;
}
function A_Light2(player: Player): void {
  player.extralight = 2;
}

function A_BFGSpray(mo: Mobj): void {
  for (let i = 0; i < 40; i++) {
    const an = (mo.angle - ANG90 / 2 + (ANG90 / 40) * i) >>> 0;
    P_AimLineAttack(mo.target!, an, 16 * 64 * FRACUNIT);
    const lt = mapState.linetarget;
    if (!lt) continue;
    P_SpawnMobj(lt.x, lt.y, (lt.z + (lt.height >> 2)) | 0, MT.MT_EXTRABFG);
    let damage = 0;
    for (let j = 0; j < 15; j++) damage += (P_Random() & 7) + 1;
    P_DamageMobj(lt, mo.target, mo.target, damage);
  }
}

function A_BFGsound(player: Player, _psp: PspDef): void {
  S_StartSound(player.mo, SFX.sfx_bfg);
}

function A_OpenShotgun2(player: Player): void {
  S_StartSound(player.mo, SFX.sfx_dbopn);
}

function A_LoadShotgun2(player: Player): void {
  S_StartSound(player.mo, SFX.sfx_dbload);
}

function A_CloseShotgun2(player: Player, psp: PspDef): void {
  S_StartSound(player.mo, SFX.sfx_dbcls);
  A_ReFire(player, psp);
}

export function P_SetupPsprites(player: Player): void {
  for (const psp of player.psprites) psp.state = null;
  player.pendingweapon = player.readyweapon;
  P_BringUpWeapon(player);
}

export function P_MovePsprites(player: Player): void {
  for (let i = 0; i < PsprNum.NUMPSPRITES; i++) {
    const psp = player.psprites[i];
    if (psp.state) {
      if (psp.tics !== -1) {
        psp.tics--;
        if (!psp.tics) P_SetPsprite(player, i, psp.state.nextstate);
      }
    }
  }
  player.psprites[PsprNum.ps_flash].sx = player.psprites[PsprNum.ps_weapon].sx;
  player.psprites[PsprNum.ps_flash].sy = player.psprites[PsprNum.ps_weapon].sy;
}

registerActions({
  A_WeaponReady, A_ReFire, A_CheckReload, A_Lower, A_Raise, A_GunFlash, A_Punch, A_Saw, A_FireMissile, A_FireBFG,
  A_FirePlasma, A_FirePistol, A_FireShotgun, A_FireShotgun2, A_FireCGun, A_Light0, A_Light1, A_Light2, A_BFGSpray,
  A_BFGsound, A_OpenShotgun2, A_LoadShotgun2, A_CloseShotgun2,
});

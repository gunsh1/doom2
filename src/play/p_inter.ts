// p_inter.c — item pickups, damage and death.
import { FRACUNIT, FixedMul } from '../core/fixed';
import { finesine, finecosine, ANG180, ANGLETOFINESHIFT } from '../core/tables';
import { P_Random } from '../core/random';
import {
  Ammo, Weapon, Card, Power, PlayerState, Skill, GameMode, INVULNTICS, INVISTICS, INFRATICS, IRONTICS, MAXHEALTH,
  MF_SHADOW, MF_DROPPED, MF_COUNTITEM, MF_SHOOTABLE, MF_FLOAT, MF_SKULLFLY, MF_NOGRAVITY, MF_CORPSE, MF_DROPOFF,
  MF_COUNTKILL, MF_SOLID, MF_NOCLIP, MF_JUSTHIT, CF_GODMODE, ONFLOORZ, BASETHRESHOLD, type Player, type Mobj,
} from '../doom/defs';
import { SPR, MT, S, states } from '../doom/info';
import { g } from '../doom/state';
import { T } from '../doom/strings';
import { SFX } from '../generated/sounds_data';
import { weaponinfo, P_DropWeapon } from './p_pspr';
import { P_RemoveMobj, P_SetMobjState, P_SpawnMobj } from './p_mobj';
import { R_PointToAngle2 } from '../render/renderer';
import { S_StartSound } from '../sound/s_sound';
import { AM_Stop } from '../game/am_map';

const BONUSADD = 6;
const clipammo = [10, 4, 20, 1];

export function P_GiveAmmo(player: Player, ammo: number, num: number): boolean {
  if (ammo === Ammo.am_noammo) return false;
  if (ammo < 0 || ammo > Ammo.NUMAMMO) throw new Error(`P_GiveAmmo: bad type ${ammo}`);
  if (player.ammo[ammo] === player.maxammo[ammo]) return false;
  if (num) num *= clipammo[ammo];
  else num = (clipammo[ammo] / 2) | 0;
  if (g.gameskill === Skill.sk_baby || g.gameskill === Skill.sk_nightmare) num <<= 1;
  const oldammo = player.ammo[ammo];
  player.ammo[ammo] += num;
  if (player.ammo[ammo] > player.maxammo[ammo]) player.ammo[ammo] = player.maxammo[ammo];
  if (oldammo) return true;
  switch (ammo) {
    case Ammo.am_clip:
      if (player.readyweapon === Weapon.wp_fist) {
        player.pendingweapon = player.weaponowned[Weapon.wp_chaingun] ? Weapon.wp_chaingun : Weapon.wp_pistol;
      }
      break;
    case Ammo.am_shell:
      if (player.readyweapon === Weapon.wp_fist || player.readyweapon === Weapon.wp_pistol) {
        if (player.weaponowned[Weapon.wp_shotgun]) player.pendingweapon = Weapon.wp_shotgun;
      }
      break;
    case Ammo.am_cell:
      if (player.readyweapon === Weapon.wp_fist || player.readyweapon === Weapon.wp_pistol) {
        if (player.weaponowned[Weapon.wp_plasma]) player.pendingweapon = Weapon.wp_plasma;
      }
      break;
    case Ammo.am_misl:
      if (player.readyweapon === Weapon.wp_fist) {
        if (player.weaponowned[Weapon.wp_missile]) player.pendingweapon = Weapon.wp_missile;
      }
      break;
  }
  return true;
}

function P_GiveWeapon(player: Player, weapon: Weapon, dropped: boolean): boolean {
  if (g.netgame && g.deathmatch !== 2 && !dropped) {
    if (player.weaponowned[weapon]) return false;
    player.bonuscount += BONUSADD;
    player.weaponowned[weapon] = true;
    P_GiveAmmo(player, weaponinfo[weapon].ammo, g.deathmatch ? 5 : 2);
    player.pendingweapon = weapon;
    if (player === g.players[g.consoleplayer]) S_StartSound(null, SFX.sfx_wpnup);
    return false;
  }
  let gaveammo = false;
  if (weaponinfo[weapon].ammo !== Ammo.am_noammo) gaveammo = P_GiveAmmo(player, weaponinfo[weapon].ammo, dropped ? 1 : 2);
  let gaveweapon: boolean;
  if (player.weaponowned[weapon]) gaveweapon = false;
  else {
    gaveweapon = true;
    player.weaponowned[weapon] = true;
    player.pendingweapon = weapon;
  }
  return gaveweapon || gaveammo;
}

export function P_GiveBody(player: Player, num: number): boolean {
  if (player.health >= MAXHEALTH) return false;
  player.health += num;
  if (player.health > MAXHEALTH) player.health = MAXHEALTH;
  player.mo!.health = player.health;
  return true;
}

function P_GiveArmor(player: Player, armortype: number): boolean {
  const hits = armortype * 100;
  if (player.armorpoints >= hits) return false;
  player.armortype = armortype;
  player.armorpoints = hits;
  return true;
}

function P_GiveCard(player: Player, card: Card): void {
  if (player.cards[card]) return;
  player.bonuscount = BONUSADD;
  player.cards[card] = true;
}

export function P_GivePower(player: Player, power: number): boolean {
  if (power === Power.pw_invulnerability) {
    player.powers[power] = INVULNTICS;
    return true;
  }
  if (power === Power.pw_invisibility) {
    player.powers[power] = INVISTICS;
    player.mo!.flags |= MF_SHADOW;
    return true;
  }
  if (power === Power.pw_infrared) {
    player.powers[power] = INFRATICS;
    return true;
  }
  if (power === Power.pw_ironfeet) {
    player.powers[power] = IRONTICS;
    return true;
  }
  if (power === Power.pw_strength) {
    P_GiveBody(player, 100);
    player.powers[power] = 1;
    return true;
  }
  if (player.powers[power]) return false;
  player.powers[power] = 1;
  return true;
}

export function P_TouchSpecialThing(special: Mobj, toucher: Mobj): void {
  const delta = (special.z - toucher.z) | 0;
  if (delta > toucher.height || delta < -8 * FRACUNIT) return;
  let sound = SFX.sfx_itemup;
  const player = toucher.player!;
  if (toucher.health <= 0) return;
  const key = (card: Card, msg: string): boolean => {
    if (!player.cards[card]) player.message = msg;
    P_GiveCard(player, card);
    return !g.netgame;
  };
  switch (special.sprite) {
    case SPR.SPR_ARM1:
      if (!P_GiveArmor(player, 1)) return;
      player.message = T.GOTARMOR;
      break;
    case SPR.SPR_ARM2:
      if (!P_GiveArmor(player, 2)) return;
      player.message = T.GOTMEGA;
      break;
    case SPR.SPR_BON1:
      player.health++;
      if (player.health > 200) player.health = 200;
      player.mo!.health = player.health;
      player.message = T.GOTHTHBONUS;
      break;
    case SPR.SPR_BON2:
      player.armorpoints++;
      if (player.armorpoints > 200) player.armorpoints = 200;
      if (!player.armortype) player.armortype = 1;
      player.message = T.GOTARMBONUS;
      break;
    case SPR.SPR_SOUL:
      player.health += 100;
      if (player.health > 200) player.health = 200;
      player.mo!.health = player.health;
      player.message = T.GOTSUPER;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_MEGA:
      if (g.gamemode !== GameMode.commercial) return;
      player.health = 200;
      player.mo!.health = player.health;
      P_GiveArmor(player, 2);
      player.message = T.GOTMSPHERE;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_BKEY:
      if (!key(Card.it_bluecard, T.GOTBLUECARD)) return;
      break;
    case SPR.SPR_YKEY:
      if (!key(Card.it_yellowcard, T.GOTYELWCARD)) return;
      break;
    case SPR.SPR_RKEY:
      if (!key(Card.it_redcard, T.GOTREDCARD)) return;
      break;
    case SPR.SPR_BSKU:
      if (!key(Card.it_blueskull, T.GOTBLUESKUL)) return;
      break;
    case SPR.SPR_YSKU:
      if (!key(Card.it_yellowskull, T.GOTYELWSKUL)) return;
      break;
    case SPR.SPR_RSKU:
      if (!key(Card.it_redskull, T.GOTREDSKULL)) return;
      break;
    case SPR.SPR_STIM:
      if (!P_GiveBody(player, 10)) return;
      player.message = T.GOTSTIM;
      break;
    case SPR.SPR_MEDI:
      if (!P_GiveBody(player, 25)) return;
      // Vanilla checks health after healing, so "really needed" never shows (kept as-is).
      player.message = player.health < 25 ? T.GOTMEDINEED : T.GOTMEDIKIT;
      break;
    case SPR.SPR_PINV:
      if (!P_GivePower(player, Power.pw_invulnerability)) return;
      player.message = T.GOTINVUL;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_PSTR:
      if (!P_GivePower(player, Power.pw_strength)) return;
      player.message = T.GOTBERSERK;
      if (player.readyweapon !== Weapon.wp_fist) player.pendingweapon = Weapon.wp_fist;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_PINS:
      if (!P_GivePower(player, Power.pw_invisibility)) return;
      player.message = T.GOTINVIS;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_SUIT:
      if (!P_GivePower(player, Power.pw_ironfeet)) return;
      player.message = T.GOTSUIT;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_PMAP:
      if (!P_GivePower(player, Power.pw_allmap)) return;
      player.message = T.GOTMAP;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_PVIS:
      if (!P_GivePower(player, Power.pw_infrared)) return;
      player.message = T.GOTVISOR;
      sound = SFX.sfx_getpow;
      break;
    case SPR.SPR_CLIP:
      if (!P_GiveAmmo(player, Ammo.am_clip, special.flags & MF_DROPPED ? 0 : 1)) return;
      player.message = T.GOTCLIP;
      break;
    case SPR.SPR_AMMO:
      if (!P_GiveAmmo(player, Ammo.am_clip, 5)) return;
      player.message = T.GOTCLIPBOX;
      break;
    case SPR.SPR_ROCK:
      if (!P_GiveAmmo(player, Ammo.am_misl, 1)) return;
      player.message = T.GOTROCKET;
      break;
    case SPR.SPR_BROK:
      if (!P_GiveAmmo(player, Ammo.am_misl, 5)) return;
      player.message = T.GOTROCKBOX;
      break;
    case SPR.SPR_CELL:
      if (!P_GiveAmmo(player, Ammo.am_cell, 1)) return;
      player.message = T.GOTCELL;
      break;
    case SPR.SPR_CELP:
      if (!P_GiveAmmo(player, Ammo.am_cell, 5)) return;
      player.message = T.GOTCELLBOX;
      break;
    case SPR.SPR_SHEL:
      if (!P_GiveAmmo(player, Ammo.am_shell, 1)) return;
      player.message = T.GOTSHELLS;
      break;
    case SPR.SPR_SBOX:
      if (!P_GiveAmmo(player, Ammo.am_shell, 5)) return;
      player.message = T.GOTSHELLBOX;
      break;
    case SPR.SPR_BPAK:
      if (!player.backpack) {
        for (let i = 0; i < Ammo.NUMAMMO; i++) player.maxammo[i] *= 2;
        player.backpack = true;
      }
      for (let i = 0; i < Ammo.NUMAMMO; i++) P_GiveAmmo(player, i, 1);
      player.message = T.GOTBACKPACK;
      break;
    case SPR.SPR_BFUG:
      if (!P_GiveWeapon(player, Weapon.wp_bfg, false)) return;
      player.message = T.GOTBFG9000;
      sound = SFX.sfx_wpnup;
      break;
    case SPR.SPR_MGUN:
      if (!P_GiveWeapon(player, Weapon.wp_chaingun, !!(special.flags & MF_DROPPED))) return;
      player.message = T.GOTCHAINGUN;
      sound = SFX.sfx_wpnup;
      break;
    case SPR.SPR_CSAW:
      if (!P_GiveWeapon(player, Weapon.wp_chainsaw, false)) return;
      player.message = T.GOTCHAINSAW;
      sound = SFX.sfx_wpnup;
      break;
    case SPR.SPR_LAUN:
      if (!P_GiveWeapon(player, Weapon.wp_missile, false)) return;
      player.message = T.GOTLAUNCHER;
      sound = SFX.sfx_wpnup;
      break;
    case SPR.SPR_PLAS:
      if (!P_GiveWeapon(player, Weapon.wp_plasma, false)) return;
      player.message = T.GOTPLASMA;
      sound = SFX.sfx_wpnup;
      break;
    case SPR.SPR_SHOT:
      if (!P_GiveWeapon(player, Weapon.wp_shotgun, !!(special.flags & MF_DROPPED))) return;
      player.message = T.GOTSHOTGUN;
      sound = SFX.sfx_wpnup;
      break;
    case SPR.SPR_SGN2:
      if (!P_GiveWeapon(player, Weapon.wp_supershotgun, !!(special.flags & MF_DROPPED))) return;
      player.message = T.GOTSHOTGUN2;
      sound = SFX.sfx_wpnup;
      break;
    default:
      throw new Error('P_SpecialThing: Unknown gettable thing');
  }
  if (special.flags & MF_COUNTITEM) player.itemcount++;
  P_RemoveMobj(special);
  player.bonuscount += BONUSADD;
  if (player === g.players[g.consoleplayer]) S_StartSound(null, sound);
}

export function P_KillMobj(source: Mobj | null, target: Mobj): void {
  target.flags &= ~(MF_SHOOTABLE | MF_FLOAT | MF_SKULLFLY);
  if (target.type !== MT.MT_SKULL) target.flags &= ~MF_NOGRAVITY;
  target.flags |= MF_CORPSE | MF_DROPOFF;
  target.height >>= 2;
  if (source && source.player) {
    if (target.flags & MF_COUNTKILL) source.player.killcount++;
    if (target.player) source.player.frags[g.players.indexOf(target.player)]++;
  } else if (!g.netgame && target.flags & MF_COUNTKILL) {
    g.players[0].killcount++;
  }
  if (target.player) {
    if (!source) target.player.frags[g.players.indexOf(target.player)]++;
    target.flags &= ~MF_SOLID;
    target.player.playerstate = PlayerState.PST_DEAD;
    P_DropWeapon(target.player);
    if (target.player === g.players[g.consoleplayer] && g.automapactive) AM_Stop();
  }
  if (target.health < -target.info.spawnhealth && target.info.xdeathstate) P_SetMobjState(target, target.info.xdeathstate);
  else P_SetMobjState(target, target.info.deathstate);
  target.tics -= P_Random() & 3;
  if (target.tics < 1) target.tics = 1;
  let item: number;
  switch (target.type) {
    case MT.MT_WOLFSS:
    case MT.MT_POSSESSED:
      item = MT.MT_CLIP;
      break;
    case MT.MT_SHOTGUY:
      item = MT.MT_SHOTGUN;
      break;
    case MT.MT_CHAINGUY:
      item = MT.MT_CHAINGUN;
      break;
    default:
      return;
  }
  const mo = P_SpawnMobj(target.x, target.y, ONFLOORZ, item);
  mo.flags |= MF_DROPPED;
}

/** Hook for force feedback / screen effects; vanilla calls I_Tactile here. */
export let onPlayerDamaged: ((amount: number) => void) | null = null;
export function setOnPlayerDamaged(fn: (amount: number) => void): void {
  onPlayerDamaged = fn;
}

export function P_DamageMobj(target: Mobj, inflictor: Mobj | null, source: Mobj | null, damage: number): void {
  if (!(target.flags & MF_SHOOTABLE)) return;
  if (target.health <= 0) return;
  if (target.flags & MF_SKULLFLY) target.momx = target.momy = target.momz = 0;
  const player = target.player;
  if (player && g.gameskill === Skill.sk_baby) damage >>= 1;
  if (inflictor && !(target.flags & MF_NOCLIP) && (!source || !source.player || source.player.readyweapon !== Weapon.wp_chainsaw)) {
    let ang = R_PointToAngle2(inflictor.x, inflictor.y, target.x, target.y);
    let thrust = (Math.imul(Math.imul(damage, FRACUNIT >> 3), 100) / target.info.mass) | 0;
    if (damage < 40 && damage > target.health && target.z - inflictor.z > 64 * FRACUNIT && P_Random() & 1) {
      ang = (ang + ANG180) >>> 0;
      thrust = Math.imul(thrust, 4);
    }
    ang >>>= ANGLETOFINESHIFT;
    target.momx = (target.momx + FixedMul(thrust, finecosine[ang])) | 0;
    target.momy = (target.momy + FixedMul(thrust, finesine[ang])) | 0;
  }
  if (player) {
    if (target.subsector.sector.special === 11 && damage >= target.health) damage = target.health - 1;
    if (damage < 1000 && (player.cheats & CF_GODMODE || player.powers[Power.pw_invulnerability])) return;
    if (player.armortype) {
      let saved = player.armortype === 1 ? (damage / 3) | 0 : (damage / 2) | 0;
      if (player.armorpoints <= saved) {
        saved = player.armorpoints;
        player.armortype = 0;
      }
      player.armorpoints -= saved;
      damage -= saved;
    }
    player.health -= damage;
    if (player.health < 0) player.health = 0;
    player.attacker = source;
    player.damagecount += damage;
    if (player.damagecount > 100) player.damagecount = 100;
    if (player === g.players[g.consoleplayer] && onPlayerDamaged) onPlayerDamaged(damage < 100 ? damage : 100);
  }
  target.health -= damage;
  if (target.health <= 0) {
    P_KillMobj(source, target);
    return;
  }
  if (P_Random() < target.info.painchance && !(target.flags & MF_SKULLFLY)) {
    target.flags |= MF_JUSTHIT;
    P_SetMobjState(target, target.info.painstate);
  }
  target.reactiontime = 0;
  if ((!target.threshold || target.type === MT.MT_VILE) && source && source !== target && source.type !== MT.MT_VILE) {
    target.target = source;
    target.threshold = BASETHRESHOLD;
    if (target.state === states[target.info.spawnstate] && target.info.seestate !== S.S_NULL) P_SetMobjState(target, target.info.seestate);
  }
}

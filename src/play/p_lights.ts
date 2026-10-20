// p_lights.c — sector lighting effects.
import { P_Random } from '../core/random';
import { FireFlicker, LightFlash, Strobe, Glow, GLOWSPEED, STROBEBRIGHT, SLOWDARK, type Sector, type Line } from '../doom/defs';
import { lv } from './p_setup';
import { P_AddThinker } from './p_tick';
import { P_FindMinSurroundingLight, P_FindSectorFromLineTag, getNextSector } from './p_spec';

export function T_FireFlicker(flick: FireFlicker): void {
  if (--flick.count) return;
  const amount = (P_Random() & 3) * 16;
  if (flick.sector.lightlevel - amount < flick.minlight) flick.sector.lightlevel = flick.minlight;
  else flick.sector.lightlevel = flick.maxlight - amount;
  flick.count = 4;
}

export function P_SpawnFireFlicker(sector: Sector): void {
  sector.special = 0;
  const flick = new FireFlicker();
  P_AddThinker(flick);
  flick.func = T_FireFlicker;
  flick.sector = sector;
  flick.maxlight = sector.lightlevel;
  flick.minlight = P_FindMinSurroundingLight(sector, sector.lightlevel) + 16;
  flick.count = 4;
}

export function T_LightFlash(flash: LightFlash): void {
  if (--flash.count) return;
  if (flash.sector.lightlevel === flash.maxlight) {
    flash.sector.lightlevel = flash.minlight;
    flash.count = (P_Random() & flash.mintime) + 1;
  } else {
    flash.sector.lightlevel = flash.maxlight;
    flash.count = (P_Random() & flash.maxtime) + 1;
  }
}

export function P_SpawnLightFlash(sector: Sector): void {
  sector.special = 0;
  const flash = new LightFlash();
  P_AddThinker(flash);
  flash.func = T_LightFlash;
  flash.sector = sector;
  flash.maxlight = sector.lightlevel;
  flash.minlight = P_FindMinSurroundingLight(sector, sector.lightlevel);
  flash.maxtime = 64;
  flash.mintime = 7;
  flash.count = (P_Random() & flash.maxtime) + 1;
}

export function T_StrobeFlash(flash: Strobe): void {
  if (--flash.count) return;
  if (flash.sector.lightlevel === flash.minlight) {
    flash.sector.lightlevel = flash.maxlight;
    flash.count = flash.brighttime;
  } else {
    flash.sector.lightlevel = flash.minlight;
    flash.count = flash.darktime;
  }
}

export function P_SpawnStrobeFlash(sector: Sector, fastOrSlow: number, inSync: number): void {
  const flash = new Strobe();
  P_AddThinker(flash);
  flash.sector = sector;
  flash.darktime = fastOrSlow;
  flash.brighttime = STROBEBRIGHT;
  flash.func = T_StrobeFlash;
  flash.maxlight = sector.lightlevel;
  flash.minlight = P_FindMinSurroundingLight(sector, sector.lightlevel);
  if (flash.minlight === flash.maxlight) flash.minlight = 0;
  sector.special = 0;
  flash.count = inSync ? 1 : (P_Random() & 7) + 1;
}

export function EV_StartLightStrobing(line: Line): void {
  let secnum = -1;
  while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
    const sec = lv.sectors[secnum];
    if (sec.specialdata) continue;
    P_SpawnStrobeFlash(sec, SLOWDARK, 0);
  }
}

export function EV_TurnTagLightsOff(line: Line): void {
  for (const sector of lv.sectors) {
    if (sector.tag !== line.tag) continue;
    let min = sector.lightlevel;
    for (const templine of sector.lines) {
      const tsec = getNextSector(templine, sector);
      if (tsec && tsec.lightlevel < min) min = tsec.lightlevel;
    }
    sector.lightlevel = min;
  }
}

export function EV_LightTurnOn(line: Line, bright: number): void {
  for (const sector of lv.sectors) {
    if (sector.tag !== line.tag) continue;
    // Vanilla keeps the computed `bright` for subsequent sectors (bug preserved).
    if (!bright) {
      for (const templine of sector.lines) {
        const temp = getNextSector(templine, sector);
        if (temp && temp.lightlevel > bright) bright = temp.lightlevel;
      }
    }
    sector.lightlevel = bright;
  }
}

export function T_Glow(gl: Glow): void {
  switch (gl.direction) {
    case -1:
      gl.sector.lightlevel -= GLOWSPEED;
      if (gl.sector.lightlevel <= gl.minlight) {
        gl.sector.lightlevel += GLOWSPEED;
        gl.direction = 1;
      }
      break;
    case 1:
      gl.sector.lightlevel += GLOWSPEED;
      if (gl.sector.lightlevel >= gl.maxlight) {
        gl.sector.lightlevel -= GLOWSPEED;
        gl.direction = -1;
      }
      break;
  }
}

export function P_SpawnGlowingLight(sector: Sector): void {
  const gl = new Glow();
  P_AddThinker(gl);
  gl.sector = sector;
  gl.minlight = P_FindMinSurroundingLight(sector, sector.lightlevel);
  gl.maxlight = sector.lightlevel;
  gl.func = T_Glow;
  gl.direction = -1;
  sector.special = 0;
}

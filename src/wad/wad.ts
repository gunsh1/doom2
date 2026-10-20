// w_wad.c — lump directory over one IWAD plus optional PWADs. Later files take precedence.

export interface LumpInfo {
  name: string;
  data: DataView;
  bytes: Uint8Array;
}

export class Wad {
  lumps: LumpInfo[] = [];
  private byName = new Map<string, number>();
  iwadName = '';

  addFile(buf: ArrayBuffer, fileName: string): void {
    const dv = new DataView(buf);
    const id = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
    if (id !== 'IWAD' && id !== 'PWAD') throw new Error(`${fileName}: not a WAD file (${id})`);
    if (id === 'IWAD' && !this.iwadName) this.iwadName = fileName;
    const numlumps = dv.getInt32(4, true);
    const infotableofs = dv.getInt32(8, true);
    for (let i = 0; i < numlumps; i++) {
      const p = infotableofs + i * 16;
      const filepos = dv.getInt32(p, true);
      const size = dv.getInt32(p + 4, true);
      const name = readName(dv, p + 8);
      const bytes = new Uint8Array(buf, filepos, size);
      this.lumps.push({ name, data: new DataView(buf, filepos, size), bytes });
    }
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.byName.clear();
    // Iterating forwards and overwriting gives the same result as vanilla's backwards scan.
    this.lumps.forEach((l, i) => this.byName.set(l.name, i));
  }

  checkNumForName(name: string): number {
    return this.byName.get(name.toUpperCase().slice(0, 8)) ?? -1;
  }

  getNumForName(name: string): number {
    const i = this.checkNumForName(name);
    if (i === -1) throw new Error(`W_GetNumForName: ${name} not found!`);
    return i;
  }

  lumpLength(lump: number): number {
    return this.lumps[lump].bytes.length;
  }

  cacheLumpNum(lump: number): DataView {
    return this.lumps[lump].data;
  }

  cacheLumpName(name: string): DataView {
    return this.lumps[this.getNumForName(name)].data;
  }

  bytesNum(lump: number): Uint8Array {
    return this.lumps[lump].bytes;
  }

  bytesName(name: string): Uint8Array {
    return this.lumps[this.getNumForName(name)].bytes;
  }
}

export function readName(dv: DataView, ofs: number, len = 8): string {
  let s = '';
  for (let i = 0; i < len; i++) {
    const c = dv.getUint8(ofs + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.toUpperCase();
}

/** The single loaded lump directory, set at startup. */
export let wad = new Wad();
export function setWad(w: Wad): void {
  wad = w;
}

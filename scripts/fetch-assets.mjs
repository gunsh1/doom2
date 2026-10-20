// Downloads freely-redistributable assets: Freedoom Phase 1 IWAD (BSD) and a GM soundfont.
// Usage: node scripts/fetch-assets.mjs
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const FREEDOOM_VER = '0.13.0';
const FREEDOOM_URL = `https://github.com/freedoom/freedoom/releases/download/v${FREEDOOM_VER}/freedoom-${FREEDOOM_VER}.zip`;
// GeneralUser GS by S. Christian Collins — free to use and redistribute.
const SF2_URL = 'https://github.com/mrbumpy409/GeneralUser-GS/raw/main/GeneralUser-GS.sf2';

async function download(url, dest) {
  console.log(`GET ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`  -> ${dest} (${buf.length} bytes)`);
}

// Minimal zip reader: finds an entry whose name ends with `suffix` via the central directory.
function unzipEntry(buf, suffix) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('zip: no end of central directory');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    if (name.endsWith(suffix)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + csize);
      return method === 0 ? Buffer.from(data) : inflateRawSync(data);
    }
    p += 46 + nlen + xlen + clen;
  }
  throw new Error(`zip: ${suffix} not found`);
}

async function main() {
  const wads = join(root, 'wads');
  const tmp = join(root, '.cache');
  mkdirSync(wads, { recursive: true });
  mkdirSync(tmp, { recursive: true });
  mkdirSync(join(root, 'public', 'sf2'), { recursive: true });

  const fd1 = join(wads, 'freedoom1.wad');
  if (!existsSync(fd1)) {
    const zip = join(tmp, 'freedoom.zip');
    await download(FREEDOOM_URL, zip);
    writeFileSync(fd1, unzipEntry(readFileSync(zip), 'freedoom1.wad'));
    console.log(`  -> ${fd1}`);
  }

  const sf2 = join(root, 'public', 'sf2', 'GeneralUser-GS.sf2');
  if (!existsSync(sf2)) await download(SF2_URL, sf2);
}

main().catch((e) => { console.error(e); process.exit(1); });

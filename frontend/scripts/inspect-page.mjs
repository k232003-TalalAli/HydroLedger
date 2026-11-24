import fs from 'node:fs';
import zlib from 'node:zlib';

const raw = fs.readFileSync('design/extracted/page0.html');
console.log('first bytes', raw.subarray(0, 40).toString('hex'));
console.log('as utf8 start', raw.subarray(0, 80).toString('utf8'));

// try gunzip / inflate
for (const name of ['gunzip', 'inflate', 'inflateRaw', 'brotliDecompress']) {
  try {
    const out = zlib[name + 'Sync'](raw);
    console.log(name, 'ok', out.length, out.subarray(0, 120).toString('utf8'));
  } catch (e) {
    console.log(name, 'fail', e.message.slice(0, 60));
  }
}

const html = fs.readFileSync('design/mock.html', 'utf8');
const manifest = JSON.parse(
  html.match(/script type="__bundler\/manifest"[^>]*>([\s\S]*?)<\/script>/)[1],
);
const id = Object.keys(manifest)[0];
const e = manifest[id];
console.log('entry type', typeof e);
if (typeof e === 'object') console.log('keys', Object.keys(e));
console.log('entry preview', JSON.stringify(e).slice(0, 400));

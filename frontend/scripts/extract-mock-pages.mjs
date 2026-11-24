import fs from 'node:fs';
import zlib from 'node:zlib';

const html = fs.readFileSync('design/mock.html', 'utf8');
const manifest = JSON.parse(
  html.match(/script type="__bundler\/manifest"[^>]*>([\s\S]*?)<\/script>/)[1],
);
const order = JSON.parse(
  html.match(/script type="__bundler\/page_order"[^>]*>([\s\S]*?)<\/script>/)[1],
);

fs.mkdirSync('design/extracted', { recursive: true });

for (const [i, id] of order.entries()) {
  const entry = manifest[id];
  const buf = Buffer.from(entry.data, 'base64');
  const text = entry.compressed
    ? zlib.gunzipSync(buf).toString('utf8')
    : buf.toString('utf8');
  const out = `design/extracted/page${i}.html`;
  fs.writeFileSync(out, text);
  console.log('wrote', out, text.length);
  for (const n of [
    'OVERVIEW',
    'HYDROLEDGER',
    'Inflow',
    'Citizen',
    'Quota',
    'Leak',
    '42.6',
    '4.5',
    'Operator',
    'Admin',
  ]) {
    console.log(' ', n, text.includes(n));
  }
  // dump visible text snippets
  const texts = [...text.matchAll(/>([^<]{3,80})</g)]
    .map((m) => m[1].trim())
    .filter((t) => t && !t.startsWith('{') && !/^[\d\s.]+$/.test(t));
  console.log(' sample texts', [...new Set(texts)].slice(0, 60));
}

import fs from 'node:fs';

const html = fs.readFileSync('design/mock.html', 'utf8');
const types = [...html.matchAll(/script type="([^"]+)"/g)].map((m) => m[1]);
console.log('script types', [...new Set(types)]);

for (const type of ['__bundler/manifest', '__bundler/page_order', '__bundler/template']) {
  const re = new RegExp(`script type="${type}"[^>]*>([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) {
    console.log(type, 'MISSING');
    continue;
  }
  const raw = m[1].trim();
  console.log(type, 'len', raw.length);
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) console.log(type, 'array', j.length, j.slice(0, 5));
    else if (j && typeof j === 'object') console.log(type, 'keys', Object.keys(j).slice(0, 20));
    else console.log(type, typeof j, String(j).slice(0, 200));
  } catch {
    console.log(type, 'not json', raw.slice(0, 120));
  }
}

// Search whole file for readable UI strings (outside binary-ish chunks)
const needles = ['OVERVIEW', 'Total Inflow', 'HYDROLEDGER', 'Active Alerts', 'L/min', 'Sector'];
for (const n of needles) {
  console.log('file has', n, html.includes(n));
}

import fs from 'node:fs';

const text = fs.readFileSync('design/extracted/page0.html', 'utf8');
const labels = [...text.matchAll(/>([^<]{2,120})</g)]
  .map((m) => m[1].replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').trim())
  .filter((t) => t && !t.startsWith('#') && !t.includes('window.') && !t.includes('JSON'));
fs.writeFileSync('design/extracted/page0-labels.txt', [...new Set(labels)].join('\n'));
const text1 = fs.readFileSync('design/extracted/page1.html', 'utf8');
const labels1 = [...text1.matchAll(/>([^<]{2,120})</g)]
  .map((m) => m[1].replace(/&nbsp;/g, ' ').replace(/&gt;/g, '>').replace(/&lt;/g, '<').trim())
  .filter((t) => t && !t.startsWith('#') && !t.includes('window.') && !t.includes('JSON'));
fs.writeFileSync('design/extracted/page1-labels.txt', [...new Set(labels1)].join('\n'));
console.log('wrote labels');

// Usage: node set-ips.js <IP_A> <IP_B> <IP_C>
// Replaces the IP_A / IP_B / IP_C placeholders in the static-nodes files and env files.
const fs = require('fs'), path = require('path');
const [A, B, C] = process.argv.slice(2);
const ok = s => /^\d{1,3}(\.\d{1,3}){3}$/.test(s || '');
if (![A, B, C].every(ok)) { console.error('usage: node set-ips.js <IP_A> <IP_B> <IP_C>   (tailscale IPs)'); process.exit(1); }
const files = [
  ...fs.readdirSync(path.join(__dirname, 'besu-net/static')).map(f => 'besu-net/static/' + f),
  ...fs.readdirSync(path.join(__dirname, 'besu-setup/envs')).map(f => 'besu-setup/envs/' + f),
];
let n = 0;
for (const f of files) {
  const p = path.join(__dirname, f);
  const t = fs.readFileSync(p, 'utf8');
  const u = t.replace(/IP_A/g, A).replace(/IP_B/g, B).replace(/IP_C/g, C);
  if (u !== t) { fs.writeFileSync(p, u); n++; }
}
console.log(n ? `updated ${n} files` : 'nothing to replace (placeholders already filled?)');

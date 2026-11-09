const { JsonRpcProvider, toUtf8String } = require('ethers');
const p = new JsonRpcProvider(process.env.RPC_URL || 'http://127.0.0.1:8545', 1338, { staticNetwork: true });
(async () => {
  const latest = await p.getBlockNumber();
  for (let n = 0; n <= latest; n++) {
    const b = await p.getBlock(n, true);
    console.log(`#${n} ${new Date(b.timestamp * 1000).toISOString()} txs=${b.transactions.length}`);
    for (const tx of b.prefetchedTransactions) {
      let d; try { d = toUtf8String(tx.data); } catch { d = tx.data; }
      console.log('   ', tx.hash, 'from', tx.from, d);
    }
  }
  process.exit(0);
})();
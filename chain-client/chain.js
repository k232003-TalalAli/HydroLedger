// Send YOUR data to the Besu chain as a real transaction, and read it back.
// Usage (CLI):   node chain.js send '{"order":123,"status":"paid"}'
//                node chain.js read 0x<txHash>
//                node chain.js status          (block number, peers, validators)
// Usage (code):  const { sendData, readData } = require('./chain');
const { JsonRpcProvider, Wallet, toUtf8Bytes, hexlify, toUtf8String } = require('ethers');

const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';   // the node on THIS laptop
const CHAIN_ID = Number(process.env.CHAIN_ID || 1337);            // matches genesis.json
// Gas is free on this chain (min-gas-price=0, zeroBaseFee), so any key works.
// Set PRIVATE_KEY in your env to use a fixed sender address.
const PRIVATE_KEY = process.env.PRIVATE_KEY || Wallet.createRandom().privateKey;

const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
const wallet = new Wallet(PRIVATE_KEY, provider);

/** Put `payload` (any JSON-able value) on-chain. Resolves once it is mined into a block. */
async function sendData(payload) {
  const bytes = toUtf8Bytes(JSON.stringify(payload));
  const tx = await wallet.sendTransaction({
    to: wallet.address,                 // data-only tx to self
    data: hexlify(bytes),
    type: 0, gasPrice: 0,               // legacy tx, zero gas price
    gasLimit: 21000 + 16 * bytes.length + 10000,
  });
  const receipt = await tx.wait(1);     // waits for the block that contains it
  return { txHash: tx.hash, blockNumber: receipt.blockNumber, from: wallet.address };
}

/** Read the data back from a tx hash. */
async function readData(txHash) {
  const tx = await provider.getTransaction(txHash);
  if (!tx) throw new Error('transaction not found');
  return JSON.parse(toUtf8String(tx.data));
}

/** Accepts strict JSON, or what PowerShell leaves after stripping quotes: {order:123,status:paid} */
function parseLoose(text) {
  try { return JSON.parse(text); } catch (_) {}
  const fixed = text
    .replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":')                 // quote keys
    .replace(/:\s*([A-Za-z_][\w .-]*?)\s*(?=[,}])/g, (m, v) =>          // quote bare string values
      /^(true|false|null)$/.test(v) ? `:${v}` : `:"${v}"`);
  return JSON.parse(fixed);
}

async function status() {
  const rpc = (m, p = []) => provider.send(m, p);
  const out = { rpc: RPC_URL, block: Number(await rpc('eth_blockNumber')) };
  try { out.peers = Number(await rpc('net_peerCount')); } catch (_) {}
  try { out.validators = await rpc('qbft_getValidatorsByBlockNumber', ['latest']); } catch (_) {}
  return out;
}

module.exports = { sendData, readData, status, provider, wallet };

if (require.main === module) {
  (async () => {
    const [cmd, arg] = process.argv.slice(2);
    if (cmd === 'send') {
      const t0 = Date.now();
      const r = await sendData(parseLoose(arg));
      console.log({ ...r, seconds: (Date.now() - t0) / 1000 });
    } else if (cmd === 'status') {
      console.log(await status());
    } else if (cmd === 'read') {
      console.log(await readData(arg));
    } else {
      console.log('usage: node chain.js send <json> | read <txHash> | status');
    }
    process.exit(0);
  })().catch(e => { console.error(e.shortMessage || e.message); process.exit(1); });
}

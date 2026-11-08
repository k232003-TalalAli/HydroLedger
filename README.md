# Hydroledger – new chain (besu-setup)
Chain ID 1338 · QBFT · 4 validators across 3 laptops
- Laptop A: hydro-node1 (p2p 30303, rpc 8545, bootnode) + hydro-node2 (p2p 30304, rpc 8546)
- Laptop B: hydro-node3 (p2p 30303, rpc 8545)
- Laptop C: hydro-node4 (p2p 30303, rpc 8545)

1. node set-ips.js <IP_A> <IP_B> <IP_C>     (once, on one laptop, BEFORE copying the folder)
2. Copy the whole folder to all 3 laptops.
3. In besu-setup/: copy envs\A.env .env (laptop A) / envs\B.env (laptop B) / envs\C.env (laptop C)
4. Open firewall (see chat instructions), start laptop A first: docker compose up -d
5. cd chain-client && npm install && node chain.js status

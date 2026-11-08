Layout (copy to each laptop next to your existing folders, overwriting):
  besu-net/genesis.json                 -> both laptops (identical)
  laptopA/besu-net-demo/*               -> Laptop A  (nodes 1,2)  replaces its besu-net-demo/
  laptopB/besu-net-demo/*               -> Laptop B  (nodes 3,4)  replaces its besu-net-demo/
  chain-client/                         -> both laptops
Node keys (besu-net/node1..4/key) stay as you have them; both laptops need all of besu-net/.
Ports per laptop: first node p2p 30303 / RPC 8545, second node p2p 30304 / RPC 8546.

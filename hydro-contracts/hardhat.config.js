require("dotenv").config();
require("@nomicfoundation/hardhat-toolbox");

// Tests run without a key. Deploy and admin scripts require OWNER_PRIVATE_KEY.
const ownerKey = process.env.OWNER_PRIVATE_KEY;

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      evmVersion: "london",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      hardfork: "london",
      initialBaseFeePerGas: 0,
    },
    besu: {
      url: process.env.RPC_URL || "http://127.0.0.1:8545",
      chainId: 1338,
      accounts: ownerKey ? [ownerKey] : [],
      gasPrice: 0,
    },
  },
};

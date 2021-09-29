const HDWalletProvider = require('@truffle/hdwallet-provider');

module.exports = {
  // Uncommenting the defaults below
  // provides for an easier quick-start with Ganache.
  // You can also follow this format for other networks;
  // see <http://truffleframework.com/docs/advanced/configuration>
  // for more details on how to specify configuration options!
  //
  networks: {
    development: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*"
    },
    testnet: {
      provider: new HDWalletProvider(process.env.PK, "https://rpc.testnet.moonbeam.network"),
      network_id: "*",
      skipDryRun: true,
      gasPrice: 1e9
    },
    mainnet: {
      provider: new HDWalletProvider(process.env.PK, "https://rpc.moonriver.moonbeam.network"),
      network_id: "*",
      skipDryRun: true,
      gasPrice: 1e9
    },
  },
  plugins: [
    "solidity-coverage",
    'truffle-plugin-verify'
  ],
  compilers: {
    solc: {
      version: "0.6.12",
      settings: {          // See the solidity docs for advice about optimization and evmVersion
        optimizer: {
          enabled: false,
          runs: 200
        },
        evmVersion: "byzantium"
      }
    }
  },
  api_keys: {
    etherscan: ''
  }
};

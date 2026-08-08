import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config({ path: "../.env.local" });

const PRIVATE_KEY         = process.env.DEPLOYER_PRIVATE_KEY ?? "";
const ETHERSCAN_API_KEY   = process.env.ETHERSCAN_API_KEY    ?? "placeholder";
const accounts = /^0x[a-fA-F0-9]{64}$/.test(PRIVATE_KEY) ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  networks: {
    ethereumSepolia: {
      url: process.env.ETHEREUM_SEPOLIA_RPC ?? process.env.NEXT_PUBLIC_ETHEREUM_SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts,
    },
    ethereumMainnet: {
      url: process.env.ETHEREUM_MAINNET_RPC ?? process.env.NEXT_PUBLIC_ETHEREUM_RPC_URL ?? "https://ethereum-rpc.publicnode.com",
      chainId: 1,
      accounts,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  paths: {
    sources: "./contracts",
    artifacts: "../src/contracts/artifacts",
  },
};

export default config;

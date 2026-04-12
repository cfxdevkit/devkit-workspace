import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.5.16",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.6.6",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    artifacts: "./hh-artifacts",
    cache: "./hh-cache",
  },
};

export default config;

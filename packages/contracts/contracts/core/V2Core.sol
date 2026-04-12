// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.5.16;

// Re-export Uniswap V2 Core contracts so Hardhat compiles them via node_modules.
// These are compiled with solc 0.5.16 (optimizer 200 runs).
// DO NOT MODIFY — any change to the source alters the init code hash.

import "@uniswap/v2-core/contracts/UniswapV2Factory.sol";
import "@uniswap/v2-core/contracts/UniswapV2Pair.sol";
import "@uniswap/v2-core/contracts/UniswapV2ERC20.sol";

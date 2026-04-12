// SPDX-License-Identifier: GPL-3.0
pragma solidity =0.6.6;

// Re-export Uniswap V2 Periphery contracts so Hardhat compiles them via node_modules.
// These are compiled with solc 0.6.6 (optimizer 200 runs).
// DO NOT MODIFY — init code hash in UniswapV2Library.sol must match UniswapV2Pair bytecode.

import "@uniswap/v2-periphery/contracts/UniswapV2Router02.sol";
import "@uniswap/v2-periphery/contracts/libraries/UniswapV2Library.sol";

// WETH9 is bundled inside v2-periphery interfaces
import "@uniswap/v2-periphery/contracts/interfaces/IWETH.sol";

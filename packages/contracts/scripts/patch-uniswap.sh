#!/usr/bin/env bash
# patch-uniswap.sh — applied automatically via postinstall
# Replaces the mainnet UniswapV2Pair init code hash in UniswapV2Library.sol
# with the hash produced by our local Hardhat build.
#
# The canonical hash (0x96e8ac...) is for Ethereum mainnet deployment.
# Our Hardhat optimised build produces a different hash.
# pairFor() in the library uses this hash, so it must match our compiled Pair.

set -e

CANONICAL="96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f"
LOCAL="5a2dc30108940dd053e5fe06fe4deb55d420828f787d508920ac29e08aed3ad9"
LIB="$(dirname "$0")/../node_modules/@uniswap/v2-periphery/contracts/libraries/UniswapV2Library.sol"

if [ ! -f "$LIB" ]; then
  echo "patch-uniswap.sh: @uniswap/v2-periphery not installed yet, skipping"
  exit 0
fi

if grep -q "$LOCAL" "$LIB"; then
  echo "patch-uniswap.sh: already patched, nothing to do"
  exit 0
fi

sed -i "s/$CANONICAL/$LOCAL/" "$LIB"
echo "patch-uniswap.sh: patched UniswapV2Library.sol init code hash"

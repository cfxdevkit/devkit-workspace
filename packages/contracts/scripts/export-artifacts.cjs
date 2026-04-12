#!/usr/bin/env node
/**
 * export-artifacts.js
 *
 * Reads Hardhat build artifacts and writes a single curated JSON file
 * per contract to packages/contracts/artifacts/.
 *
 * The exported format is:
 *   { contractName, abi, bytecode, deployedBytecode }
 *
 * Note: bytecode = creation code (used for keccak256 init code hash verification).
 *       deployedBytecode = runtime code (deployed to chain).
 *
 * Run after `pnpm compile`:
 *   node scripts/export-artifacts.js
 */

const fs   = require('node:fs');
const path = require('node:path');

const HH_ARTIFACTS = path.join(__dirname, '..', 'hh-artifacts');
const OUT_DIR      = path.join(__dirname, '..', 'artifacts');

// Contracts we want to export. Key = output filename (no .json), value = Hardhat path.
// V2Core/V2Periphery wrappers cause Hardhat to compile dependencies into @uniswap/ subdirs.
const CONTRACTS = {
  // V2 Core (compiled from @uniswap/v2-core/contracts/)
  UniswapV2Factory:  '@uniswap/v2-core/contracts/UniswapV2Factory.sol/UniswapV2Factory.json',
  UniswapV2Pair:     '@uniswap/v2-core/contracts/UniswapV2Pair.sol/UniswapV2Pair.json',
  UniswapV2ERC20:    '@uniswap/v2-core/contracts/UniswapV2ERC20.sol/UniswapV2ERC20.json',
  // V2 Periphery (compiled from @uniswap/v2-periphery/contracts/)
  UniswapV2Router02: '@uniswap/v2-periphery/contracts/UniswapV2Router02.sol/UniswapV2Router02.json',
  WETH9:             'contracts/periphery/WETH9.sol/WETH9.json',
  // Test / mirror tokens
  MirrorERC20:       'contracts/test/MirrorERC20.sol/MirrorERC20.json',
  TestERC20:         'contracts/test/TestERC20.sol/TestERC20.json',
  PayableVault:      'contracts/test/PayableVault.sol/PayableVault.json',
  // Mocks
  MockUSDT0:         'contracts/mocks/MockUSDT0.sol/MockUSDT0.json',
  MockAxCNH:         'contracts/mocks/MockAxCNH.sol/MockAxCNH.json',
};

fs.mkdirSync(OUT_DIR, { recursive: true });

let allOk = true;

for (const [name, relPath] of Object.entries(CONTRACTS)) {
  const src = path.join(HH_ARTIFACTS, relPath);
  if (!fs.existsSync(src)) {
    console.error(`✗  Missing artifact: ${relPath} — run 'pnpm compile' first`);
    allOk = false;
    continue;
  }

  const hh = JSON.parse(fs.readFileSync(src, 'utf8'));
  const out = {
    contractName:      hh.contractName,
    abi:               hh.abi,
    bytecode:          hh.bytecode,          // creation bytecode
    deployedBytecode:  hh.deployedBytecode,  // runtime bytecode
  };

  const dest = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log(`✓  ${name} → artifacts/${name}.json  (bytecode: ${hh.bytecode.length / 2 - 1} bytes)`);
}

if (!allOk) {
  console.error('\nSome artifacts missing — run: pnpm compile');
  process.exit(1);
}

// ── Init code hash verification ────────────────────────────────────────────
const { createHash } = require('node:crypto');

const pairArtifact = JSON.parse(
  fs.readFileSync(path.join(OUT_DIR, 'UniswapV2Pair.json'), 'utf8')
);

const creationBytecode = pairArtifact.bytecode.slice(2); // strip 0x
const _hash = `0x${createHash('sha256')  // Note: Solidity uses keccak256 not sha256
  // We just print the hex — actual keccak256 done via viem in verify-hash.ts
  .update(Buffer.from(creationBytecode, 'hex'))
  .digest('hex')}`;

// Write a hash-info file for reference
const canonicalHash = '0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f';
const info = {
  note: 'Run verify-hash.ts for the actual keccak256 init code hash.',
  canonicalInitCodeHash: canonicalHash,
  pairBytecodeLength: creationBytecode.length / 2,
};
fs.writeFileSync(path.join(OUT_DIR, '_hash-info.json'), JSON.stringify(info, null, 2));
console.log('\n📋  Wrote _hash-info.json — run verify-hash.ts to check keccak256 hash.');

/**
 * verify-hash.ts
 *
 * Computes the keccak256 of the UniswapV2Pair creation bytecode and compares
 * it to the canonical init code hash embedded in UniswapV2Library.sol.
 *
 * Usage:
 *   npx ts-node scripts/verify-hash.ts
 *
 * If hashes differ, the library must be patched before deploying the Router.
 * See plan.md §5.3 for patching instructions.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256 } from "viem";

const ARTIFACTS_DIR = join(__dirname, "..", "artifacts");
const CANONICAL_HASH =
	"0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f";

const pairArtifact = JSON.parse(
	readFileSync(join(ARTIFACTS_DIR, "UniswapV2Pair.json"), "utf8"),
);

const computedHash = keccak256(pairArtifact.bytecode as `0x${string}`);

console.log("");
console.log("UniswapV2Pair init code hash verification");
console.log("─────────────────────────────────────────");
console.log(`Computed:  ${computedHash}`);
console.log(`Canonical: ${CANONICAL_HASH}`);

if (computedHash === CANONICAL_HASH) {
	console.log(
		"\n✅  Hashes match — UniswapV2Library.sol does NOT need patching.",
	);
} else {
	console.log(
		"\n⚠️   Hash mismatch — UniswapV2Library.sol MUST be patched before deploying Router.",
	);
	console.log(
		`    Replace the hex value in UniswapV2Library.sol with: ${computedHash}`,
	);
	console.log("    Then re-run: pnpm compile && pnpm export");
}

// Write result to artifacts for use by deploy scripts
const result = {
	computedHash,
	canonicalHash: CANONICAL_HASH,
	match: computedHash === CANONICAL_HASH,
	patchRequired: computedHash !== CANONICAL_HASH,
};

writeFileSync(
	join(ARTIFACTS_DIR, "_init-code-hash.json"),
	JSON.stringify(result, null, 2),
);
console.log("\n📋  Written to artifacts/_init-code-hash.json");

if (computedHash !== CANONICAL_HASH) {
	process.exit(1);
}

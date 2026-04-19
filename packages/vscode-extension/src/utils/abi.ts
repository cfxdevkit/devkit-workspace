/**
 * utils/abi.ts
 *
 * Solidity ABI encoder, decoder, and keccak256 for the VS Code extension host.
 * No external dependencies — pure TypeScript, works in both Node.js and Electron.
 *
 * Supported types for encoding:
 *   address, uint*, int*, bool, bytesN (fixed), bytes (dynamic), string,
 *   T[] (dynamic arrays of primitive types)
 *
 * Supported types for decoding:
 *   uint*, address, bool, string — others returned as raw hex.
 *
 * Not yet supported:
 *   tuple types (structs), fixed-size arrays T[N] with complex element types.
 *   For unsupported types, encodeCalldata returns null and the caller should
 *   fall back to the cfxdevkit MCP tool (cfxdevkit_contract_call).
 *
 * The `components` field on AbiInput is reserved for future tuple support.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AbiInput {
	name: string;
	type: string;
	/** For tuple types (structs). Reserved — tuple encoding not yet implemented. */
	components?: AbiInput[];
}

export interface AbiFunction {
	type: "function";
	name: string;
	inputs: AbiInput[];
	outputs?: AbiInput[];
	stateMutability: "view" | "pure" | "nonpayable" | "payable";
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Encode a function call to raw calldata bytes.
 * Returns null for unsupported types (caller must fall back to MCP tool).
 */
export function encodeCalldata(
	fn: AbiFunction,
	args: unknown[],
): Uint8Array | null {
	try {
		const sig = `${fn.name}(${fn.inputs.map((i) => i.type).join(",")})`;
		const selector = keccak256Selector(sig);
		const encoded = abiEncode(fn.inputs, args);
		if (!encoded) return null;
		const result = new Uint8Array(4 + encoded.length);
		result.set(selector, 0);
		result.set(encoded, 4);
		return result;
	} catch {
		return null;
	}
}

/**
 * Decode an eth_call / cfx_call hex result into a human-readable string.
 * For unsupported output types, returns the raw hex.
 */
export function decodeResult(
	outputs: AbiInput[] | undefined,
	hex: string,
): string {
	if (!outputs?.length) return hex;
	try {
		const bytes = hexToBytes(hex.replace("0x", ""));
		const results: unknown[] = [];
		let offset = 0;
		for (const out of outputs) {
			if (out.type === "uint256" || out.type.startsWith("uint")) {
				const val = BigInt(
					`0x${bytesToHex(bytes.slice(offset, offset + 32)).replace("0x", "")}`,
				);
				results.push(val.toString());
				offset += 32;
			} else if (out.type === "address") {
				results.push(
					`0x${bytesToHex(bytes.slice(offset + 12, offset + 32)).replace("0x", "")}`,
				);
				offset += 32;
			} else if (out.type === "bool") {
				results.push(bytes[offset + 31] !== 0);
				offset += 32;
			} else if (out.type === "string") {
				const strOffset = Number(
					BigInt(
						`0x${bytesToHex(bytes.slice(offset, offset + 32)).replace("0x", "")}`,
					),
				);
				const strLen = Number(
					BigInt(
						`0x${bytesToHex(bytes.slice(strOffset, strOffset + 32)).replace("0x", "")}`,
					),
				);
				results.push(
					new TextDecoder().decode(
						bytes.slice(strOffset + 32, strOffset + 32 + strLen),
					),
				);
				offset += 32;
			} else {
				// Generic fallback: return hex
				results.push(bytesToHex(bytes.slice(offset, offset + 32)));
				offset += 32;
			}
		}
		return results.length === 1 ? String(results[0]) : JSON.stringify(results);
	} catch {
		return hex;
	}
}

/** Convert a Uint8Array to a 0x-prefixed hex string. */
export function bytesToHex(bytes: Uint8Array): string {
	return `0x${Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Compute keccak256(str)[0:4] — the 4-byte Ethereum function selector. */
function keccak256Selector(sig: string): Uint8Array {
	const bytes = new TextEncoder().encode(sig);
	return keccak256(bytes).slice(0, 4);
}

function abiEncode(inputs: AbiInput[], args: unknown[]): Uint8Array | null {
	if (inputs.length !== args.length) return null;

	const parts: Uint8Array[] = [];
	const dynamicParts: Uint8Array[] = [];
	let headOffset = inputs.length * 32;

	for (let i = 0; i < inputs.length; i++) {
		const type = inputs[i].type;
		const val = args[i];

		if (isDynamic(type)) {
			const dynamic = encodeDynamic(type, val);
			if (!dynamic) return null;
			dynamicParts.push(dynamic);
			parts.push(padUint(BigInt(headOffset)));
			headOffset += dynamic.length;
		} else {
			const enc = encodeStatic(type, val);
			if (!enc) return null;
			parts.push(enc);
		}
	}

	const all = [...parts, ...dynamicParts];
	const total = all.reduce((s, p) => s + p.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const p of all) {
		result.set(p, offset);
		offset += p.length;
	}
	return result;
}

function isDynamic(type: string): boolean {
	return type === "string" || type === "bytes" || type.endsWith("[]");
}

function encodeStatic(type: string, val: unknown): Uint8Array | null {
	if (type === "address") {
		const hex = (val as string).replace("0x", "").padStart(64, "0");
		return hexToBytes(hex);
	}
	if (type === "bool") {
		return padUint(BigInt(val ? 1 : 0));
	}
	if (type.startsWith("uint") || type.startsWith("int")) {
		let num: bigint;
		try {
			num = typeof val === "bigint" ? val : BigInt(val as string);
		} catch {
			return null;
		}
		if (num < 0n) {
			const bits =
				type.startsWith("int") && type !== "int"
					? parseInt(type.replace("int", "") || "256", 10)
					: 256;
			num = (1n << BigInt(bits)) + num;
		}
		return padUint(num);
	}
	if (type.startsWith("bytes") && !type.endsWith("[]")) {
		const size = parseInt(type.replace("bytes", ""), 10) || 0;
		if (!size || size > 32) return null;
		const hex = (val as string).replace("0x", "").padEnd(size * 2, "0");
		return hexToBytes(hex.padEnd(64, "0").slice(0, 64));
	}
	return null;
}

function encodeDynamic(type: string, val: unknown): Uint8Array | null {
	if (type === "string" || type === "bytes") {
		const bytes =
			type === "string"
				? new TextEncoder().encode(val as string)
				: hexToBytes((val as string).replace("0x", ""));
		const len = padUint(BigInt(bytes.length));
		const padded = new Uint8Array(Math.ceil(bytes.length / 32) * 32);
		padded.set(bytes);
		return concat([len, padded]);
	}
	return null;
}

function padUint(val: bigint): Uint8Array {
	const hex = val.toString(16).padStart(64, "0");
	return hexToBytes(hex);
}

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.length % 2 ? `0${hex}` : hex;
	const arr = new Uint8Array(clean.length / 2);
	for (let i = 0; i < arr.length; i++) {
		arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
	}
	return arr;
}

function concat(arrays: Uint8Array[]): Uint8Array {
	const total = arrays.reduce((s, a) => s + a.length, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const a of arrays) {
		result.set(a, offset);
		offset += a.length;
	}
	return result;
}

// ── Keccak-256 (pure TypeScript) ──────────────────────────────────────────────
// Reference implementation — correct for all inputs.

function keccak256(data: Uint8Array): Uint8Array {
	const RC: bigint[] = [
		0x0000000000000001n,
		0x0000000000008082n,
		0x800000000000808an,
		0x8000000080008000n,
		0x000000000000808bn,
		0x0000000080000001n,
		0x8000000080008081n,
		0x8000000000008009n,
		0x000000000000008an,
		0x0000000000000088n,
		0x0000000080008009n,
		0x000000008000000an,
		0x000000008000808bn,
		0x800000000000008bn,
		0x8000000000008089n,
		0x8000000000008003n,
		0x8000000000008002n,
		0x8000000000000080n,
		0x000000000000800an,
		0x800000008000000an,
		0x8000000080008081n,
		0x8000000000008080n,
		0x0000000080000001n,
		0x8000000080008008n,
	];
	const ROTATIONS = [
		[0, 36, 3, 41, 18],
		[1, 44, 10, 45, 2],
		[62, 6, 43, 15, 61],
		[28, 55, 25, 21, 56],
		[27, 20, 39, 8, 14],
	];

	function rotl64(x: bigint, n: number): bigint {
		return ((x << BigInt(n)) | (x >> BigInt(64 - n))) & 0xffffffffffffffffn;
	}

	// Padding (Keccak, not SHA-3 — uses 0x01 not 0x06)
	const rate = 136; // 1088 bits / 8
	const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
	padded.set(data);
	padded[data.length] = 0x01;
	padded[padded.length - 1] ^= 0x80;

	const state: bigint[][] = Array.from({ length: 5 }, () =>
		new Array(5).fill(0n),
	);

	for (let block = 0; block < padded.length; block += rate) {
		for (let i = 0; i < rate / 8; i++) {
			const x = i % 5;
			const y = Math.floor(i / 5);
			let lane = 0n;
			for (let b = 0; b < 8; b++) {
				lane |= BigInt(padded[block + i * 8 + b]) << BigInt(b * 8);
			}
			state[x][y] ^= lane;
		}
		for (let round = 0; round < 24; round++) {
			// θ
			const C: bigint[] = state.map((col) => col.reduce((a, b) => a ^ b));
			const D: bigint[] = C.map(
				(_, i) => C[(i + 4) % 5] ^ rotl64(C[(i + 1) % 5], 1),
			);
			for (let x = 0; x < 5; x++)
				for (let y = 0; y < 5; y++) state[x][y] ^= D[x];
			// ρ and π
			const B: bigint[][] = Array.from({ length: 5 }, () =>
				new Array(5).fill(0n),
			);
			for (let x = 0; x < 5; x++)
				for (let y = 0; y < 5; y++) {
					B[y][(2 * x + 3 * y) % 5] = rotl64(state[x][y], ROTATIONS[x][y]);
				}
			// χ
			for (let x = 0; x < 5; x++)
				for (let y = 0; y < 5; y++) {
					state[x][y] = B[x][y] ^ (~B[(x + 1) % 5][y] & B[(x + 2) % 5][y]);
				}
			// ι
			state[0][0] ^= RC[round];
		}
	}

	// Squeeze (256 bits = 32 bytes)
	const output = new Uint8Array(32);
	for (let i = 0; i < 4; i++) {
		const lane = state[i % 5][Math.floor(i / 5)];
		for (let b = 0; b < 8; b++) {
			output[i * 8 + b] = Number((lane >> BigInt(b * 8)) & 0xffn);
		}
	}
	return output;
}

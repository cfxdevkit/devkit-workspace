/**
 * conflux-address.ts
 *
 * CIP-37 Conflux Core Space base32 address encoding, decoding, and network
 * prefix conversion.  Lets us display the same underlying account in different
 * network formats (local net2029: / testnet cfxtest: / mainnet cfx:) without
 * requiring an external library.
 *
 * Key facts:
 *  - The underlying 20-byte address is the same across all three networks.
 *  - Only the prefix and the 8-character polymod checksum change between networks.
 *  - The version byte is always 0x00 in the current Conflux implementation.
 *
 * Reference: https://github.com/Conflux-Chain/CIPs/blob/master/CIPs/cip-37.md
 */

/** Conflux base32 alphabet (no i, l, o, q) */
const B32 = 'abcdefghjkmnprstuvwxyz0123456789';
const B32_MAP = new Map([...B32].map((c, i) => [c, i]));

/** Expand prefix bytes for polymod input (low 5 bits of each char, then a 0-separator) */
function expandPrefix(prefix: string): number[] {
  return [...prefix.toLowerCase()].map(c => c.charCodeAt(0) & 0x1f).concat(0);
}

/**
 * CIP-37 / BCH polymod checksum over a sequence of 5-bit values.
 * Returns a 40-bit bigint.
 */
function polymod(v: number[]): bigint {
  const C = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
  let c = 1n;
  for (const d of v) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) {
      if ((c0 >> BigInt(i)) & 1n) c ^= C[i];
    }
  }
  return c ^ 1n;
}

/**
 * Regroup an array of `fromBits`-wide integers into `toBits`-wide integers.
 * @param pad - if true, right-pad the last output word with zero bits.
 */
function convertBits(data: number[], fromBits: number, toBits: number, pad = true): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << toBits) - 1;
  for (const v of data) {
    acc = (acc << fromBits) | v;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) {
    out.push((acc << (toBits - bits)) & maxv);
  }
  return out;
}

/**
 * Decode a Conflux CIP-37 base32 address.
 * Returns the embedded 20-byte address as a 0x-prefixed hex string.
 */
export function decodeConfluxAddress(address: string): { prefix: string; hexAddress: string } {
  const lower = address.toLowerCase();
  const colonIdx = lower.lastIndexOf(':');
  if (colonIdx < 0) throw new Error(`Invalid Conflux address (no colon): ${address}`);
  const prefix = lower.slice(0, colonIdx);
  const payload = lower.slice(colonIdx + 1);

  const values = [...payload].map(c => {
    const v = B32_MAP.get(c);
    if (v === undefined) throw new Error(`Invalid base32 char '${c}' in address`);
    return v;
  });

  // Payload = 34 data chars + 8 checksum chars = 42 total
  const data5 = values.slice(0, -8);

  // Convert 5-bit groups → 8-bit bytes: [version_byte, addr[0]…addr[19]]
  const bytes = convertBits(data5, 5, 8, false);

  // bytes[0] = version byte (0x00 for all current Conflux addresses)
  // bytes[1..20] = raw 20-byte address
  const addrBytes = bytes.slice(1, 21);
  const hexAddress = `0x${addrBytes.map(b => b.toString(16).padStart(2, '0')).join('')}`;
  return { prefix, hexAddress };
}

/**
 * Encode a 20-byte hex address as a Conflux CIP-37 base32 address.
 * @param hexAddress  0x-prefixed 40-hex-char address (same bytes as EVM address)
 * @param networkPrefix  'cfx' | 'cfxtest' | 'net{chainId}'
 */
export function encodeConfluxAddress(hexAddress: string, networkPrefix: string): string {
  const clean = hexAddress.replace(/^0x/i, '');
  if (clean.length !== 40) throw new Error(`Expected 20-byte address, got: ${hexAddress}`);
  const addrBytes = Array.from({ length: 20 }, (_, i) =>
    parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  );

  // Version byte: always 0x00 in the current Conflux CIP-37 implementation
  const payload8 = [0x00, ...addrBytes];            // 21 bytes = 168 bits
  const data5 = convertBits(payload8, 8, 5, true);  // → 34 five-bit words

  // Compute polymod checksum over expanded-prefix + data + 8 zero placeholders
  const checksumInput = [...expandPrefix(networkPrefix), ...data5, 0, 0, 0, 0, 0, 0, 0, 0];
  const mod = polymod(checksumInput);

  // Extract 8 five-bit checksum words from the 40-bit result (MSB first)
  const check5: number[] = [];
  for (let i = 7; i >= 0; i--) {
    check5.push(Number((mod >> BigInt(i * 5)) & 0x1fn));
  }

  const encoded = [...data5, ...check5].map(v => B32[v]).join('');
  return `${networkPrefix.toLowerCase()}:${encoded}`;
}

/**
 * Convert a Conflux Core Space address from one network prefix to another.
 *
 * @example
 *   convertCoreAddressNetwork('net2029:aar3xxxx…', 1)    // → 'cfxtest:aar3xxxx…'
 *   convertCoreAddressNetwork('net2029:aar3xxxx…', 1029) // → 'cfx:aar3xxxx…'
 */
export function convertCoreAddressNetwork(coreAddress: string, targetChainId: number): string {
  const { hexAddress } = decodeConfluxAddress(coreAddress);
  const prefix =
    targetChainId === 1029 ? 'cfx' :
    targetChainId === 1    ? 'cfxtest' :
    `net${targetChainId}`;
  return encodeConfluxAddress(hexAddress, prefix);
}

/** Map a chain ID to its canonical Core Space address prefix */
export function chainIdToPrefix(chainId: number): string {
  return chainId === 1029 ? 'cfx' : chainId === 1 ? 'cfxtest' : `net${chainId}`;
}

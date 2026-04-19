#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const outputDir = resolve(process.cwd(), "generated");
mkdirSync(outputDir, { recursive: true });

const artifact = `export const exampleCounterArtifact = ${JSON.stringify(
	{
		contractName: "ExampleCounter",
		chainId: 2030,
		address: null,
		abi: [
			{
				type: "event",
				anonymous: false,
				inputs: [
					{ name: "account", type: "address", internalType: "address", indexed: true },
					{ name: "amount", type: "uint256", internalType: "uint256", indexed: false },
					{ name: "unlockTimestamp", type: "uint64", internalType: "uint64", indexed: false },
				],
				name: "FundsLocked",
			},
			{
				type: "event",
				anonymous: false,
				inputs: [
					{ name: "account", type: "address", internalType: "address", indexed: true },
					{ name: "amount", type: "uint256", internalType: "uint256", indexed: false },
				],
				name: "FundsWithdrawn",
			},
			{
				type: "event",
				anonymous: false,
				inputs: [{ name: "value", type: "uint256", internalType: "uint256", indexed: false }],
				name: "ValueChanged",
			},
			{
				type: "function",
				inputs: [{ name: "account", internalType: "address", type: "address" }],
				name: "getLock",
				outputs: [
					{ name: "amount", internalType: "uint256", type: "uint256" },
					{ name: "unlockTimestamp", internalType: "uint64", type: "uint64" },
					{ name: "claimable", internalType: "bool", type: "bool" },
				],
				stateMutability: "view",
			},
			{
				type: "function",
				inputs: [],
				name: "increment",
				outputs: [],
				stateMutability: "nonpayable",
			},
			{
				type: "function",
				inputs: [{ name: "unlockTimestamp", internalType: "uint64", type: "uint64" }],
				name: "lock",
				outputs: [],
				stateMutability: "payable",
			},
			{
				type: "function",
				inputs: [],
				name: "reset",
				outputs: [],
				stateMutability: "nonpayable",
			},
			{
				type: "function",
				inputs: [],
				name: "value",
				outputs: [{ name: "", internalType: "uint256", type: "uint256" }],
				stateMutability: "view",
			},
			{
				type: "function",
				inputs: [],
				name: "withdrawLocked",
				outputs: [],
				stateMutability: "nonpayable",
			},
		],
	},
	null,
	2,
)};\n`;

writeFileSync(resolve(outputDir, "example-counter.js"), artifact);
console.log("Wrote contracts/generated/example-counter.js");

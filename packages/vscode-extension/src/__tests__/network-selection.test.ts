import { describe, expect, it } from "vitest";
import { resolveNetworkSelection } from "../views/network-selection";

describe("resolveNetworkSelection", () => {
	it("maps local backend mode to local selection", () => {
		expect(
			resolveNetworkSelection({
				mode: "local",
				chainId: 2029,
				evmChainId: 2030,
				public: {},
			}),
		).toBe("local");
	});

	it("maps public testnet chain ids to testnet", () => {
		expect(
			resolveNetworkSelection({
				mode: "public",
				chainId: 1,
				evmChainId: 71,
				public: {
					coreRpcUrl: "https://test.confluxrpc.com",
					evmRpcUrl: "https://evmtestnet.confluxrpc.com",
				},
			}),
		).toBe("testnet");
	});

	it("maps public mainnet chain ids to mainnet", () => {
		expect(
			resolveNetworkSelection({
				mode: "public",
				chainId: 1029,
				evmChainId: 1030,
				public: {
					coreRpcUrl: "https://main.confluxrpc.com",
					evmRpcUrl: "https://evm.confluxrpc.com",
				},
			}),
		).toBe("mainnet");
	});

	it("falls back to RPC url hints when chain ids are missing", () => {
		expect(
			resolveNetworkSelection({
				mode: "public",
				chainId: 0,
				evmChainId: 0,
				public: {
					coreRpcUrl: "https://test.confluxrpc.com",
					evmRpcUrl: "https://evmtestnet.confluxrpc.com",
				},
			}),
		).toBe("testnet");
	});

	it("returns null for unsupported custom public networks", () => {
		expect(
			resolveNetworkSelection({
				mode: "public",
				chainId: 9999,
				evmChainId: 9998,
				public: {
					coreRpcUrl: "https://custom.example.invalid",
					evmRpcUrl: "https://rpc.example.invalid",
				},
			}),
		).toBeNull();
	});
});

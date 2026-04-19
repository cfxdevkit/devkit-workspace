import { defineChain } from "viem";

export const confluxLocalESpace = defineChain({
	id: 2030,
	name: "Conflux eSpace (Local)",
	nativeCurrency: { name: "CFX", symbol: "CFX", decimals: 18 },
	rpcUrls: {
		default: { http: [`${import.meta.env.BASE_URL}rpc`] },
	},
});

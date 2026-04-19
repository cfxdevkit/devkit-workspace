import { describe, expect, it } from "vitest";
import { deriveCoreAddressForNetwork } from "../utils/core-address-display";

describe("deriveCoreAddressForNetwork", () => {
	it("re-encodes a local core address for testnet", () => {
		const derived = deriveCoreAddressForNetwork({
			coreAddress: "net2029:acc7uawf5ubtnmezv7jzdf6zr0cu4ggm0af9b4ws6r",
			targetChainId: 1,
		});

		expect(derived.startsWith("cfxtest:")).toBe(true);
	});

	it("falls back to the evm address when the stored core address is invalid", () => {
		const derived = deriveCoreAddressForNetwork({
			coreAddress: "net2029:not-a-valid-core-address",
			evmAddress: "0x0123456789abcdef0123456789abcdef01234567",
			targetChainId: 1,
		});

		expect(derived.startsWith("cfxtest:")).toBe(true);
	});
});

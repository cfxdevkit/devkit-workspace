import {
	COUNTER_SOURCE,
	type CompilationInput,
	compileSolidity,
	ERC721_SOURCE,
	ESCROW_SOURCE,
	getCounterContract,
	getERC721Contract,
	getEscrowContract,
	getMultiSigContract,
	getRegistryContract,
	getSimpleStorageContract,
	getTestTokenContract,
	getVotingContract,
	MULTISIG_SOURCE,
	REGISTRY_SOURCE,
	SIMPLE_STORAGE_SOURCE,
	TEST_TOKEN_SOURCE,
	VOTING_SOURCE,
} from "@cfxdevkit/compiler";

type TemplateDef = {
	name: string;
	description: string;
	source: string;
	get: () => { abi: unknown[]; bytecode: string };
};

const TEMPLATES = {
	SimpleStorage: {
		name: "SimpleStorage",
		description: "Basic key-value storage — great for testing reads/writes",
		source: SIMPLE_STORAGE_SOURCE,
		get: getSimpleStorageContract,
	},
	TestToken: {
		name: "TestToken",
		description:
			"ERC-20 token with mint/burn — useful for DeFi and transfer testing",
		source: TEST_TOKEN_SOURCE,
		get: getTestTokenContract,
	},
	Counter: {
		name: "Counter",
		description:
			"Ownable step counter with increment/decrement/reset — ideal first contract",
		source: COUNTER_SOURCE,
		get: getCounterContract,
	},
	BasicNFT: {
		name: "BasicNFT",
		description:
			"ERC-721 NFT from scratch — teaches token ownership, approvals, and transfers",
		source: ERC721_SOURCE,
		get: getERC721Contract,
	},
	Voting: {
		name: "Voting",
		description:
			"Ballot with vote delegation — teaches structs, weighted votes, governance",
		source: VOTING_SOURCE,
		get: getVotingContract,
	},
	Escrow: {
		name: "Escrow",
		description:
			"Three-party escrow with arbiter — teaches payable, state machines, CFX transfers",
		source: ESCROW_SOURCE,
		get: getEscrowContract,
	},
	MultiSigWallet: {
		name: "MultiSigWallet",
		description:
			"M-of-N multi-signature wallet — teaches collective governance and low-level call",
		source: MULTISIG_SOURCE,
		get: getMultiSigContract,
	},
	Registry: {
		name: "Registry",
		description:
			"On-chain name registry — teaches keccak256 keys, mappings, and string storage",
		source: REGISTRY_SOURCE,
		get: getRegistryContract,
	},
} as const satisfies Record<string, TemplateDef>;

export class ContractsCatalogService {
	listTemplates(): Array<{
		name: string;
		description: string;
		source: string;
	}> {
		return Object.values(TEMPLATES).map((t) => ({
			name: t.name,
			description: t.description,
			source: t.source,
		}));
	}

	getTemplate(
		name: string,
	): { name: string; source: string; abi: unknown[]; bytecode: string } | null {
		const template = TEMPLATES[name as keyof typeof TEMPLATES];
		if (!template) return null;

		const { abi, bytecode } = template.get();
		return {
			name,
			source: template.source,
			abi,
			bytecode,
		};
	}

	compile(params: { source?: string; contractName?: string }):
		| { ok: false; status: 400; error: string }
		| { ok: false; status: 422; error: string; details: unknown }
		| {
				ok: true;
				payload: { contractName: string; abi: unknown[]; bytecode: string };
		  } {
		const { source, contractName } = params;
		if (!source) {
			return { ok: false, status: 400, error: "source is required" };
		}

		const input: CompilationInput = {
			source,
			contractName: contractName ?? "Contract",
		};

		const result = compileSolidity(input);
		if (!result.success || result.contracts.length === 0) {
			return {
				ok: false,
				status: 422,
				error: "Compilation failed",
				details: result.errors,
			};
		}

		const contract = result.contracts[0];
		return {
			ok: true,
			payload: {
				contractName: contract.contractName,
				abi: contract.abi,
				bytecode: contract.bytecode,
			},
		};
	}
}

import type { AccountInfo, BootstrapEntry, DevkitConfig } from "@devkit/shared";
import type { DevkitClient } from "../clients/devkit-client.js";

type ToolArgs = Record<string, unknown>;

function argDefault(
	placeholder: string | undefined,
	defaultAddr: string,
): string {
	if (!placeholder) return "";
	// Replace 0x... / 0xabc... placeholder patterns with a concrete local account.
	if (/^0x[….]/.test(placeholder) || /^0x[a-fA-F0-9]{3}…/.test(placeholder)) {
		return defaultAddr;
	}
	// Comma-separated address lists are typically owner arrays; seed with one usable address.
	if (/^0x[a-fA-F0-9]{3}.*,\s*0x/.test(placeholder)) {
		return defaultAddr;
	}
	return placeholder;
}

function isProvidedArg(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string" && value.trim().length === 0) return false;
	return true;
}

function buildBootstrapArgs(params: {
	entry: BootstrapEntry;
	providedArgs: unknown[];
	defaultAddress: string;
}): {
	resolvedArgs: unknown[];
	missingArgs: Array<{
		index: number;
		name: string;
		type: string;
		description?: string;
	}>;
	extraArgs: number;
} {
	const { entry, providedArgs, defaultAddress } = params;
	const schema = entry.constructorArgs ?? [];
	const resolvedArgs: unknown[] = [];
	const missingArgs: Array<{
		index: number;
		name: string;
		type: string;
		description?: string;
	}> = [];

	for (let i = 0; i < schema.length; i += 1) {
		const def = schema[i];
		const supplied = providedArgs[i];
		if (isProvidedArg(supplied)) {
			resolvedArgs.push(supplied);
			continue;
		}

		const fallback = argDefault(def.placeholder, defaultAddress);
		if (fallback.length > 0) {
			resolvedArgs.push(fallback);
			continue;
		}

		missingArgs.push({
			index: i,
			name: def.name,
			type: def.type,
			description: def.description,
		});
	}

	const extraArgs =
		providedArgs.length > schema.length
			? providedArgs.length - schema.length
			: 0;
	return { resolvedArgs, missingArgs, extraArgs };
}

/**
 * Returns the correct default address for the target chain.
 * Core Space uses base32 addresses (net2029:…), eSpace uses 0x addresses.
 */
async function getDefaultAddressForChain(
	client: DevkitClient,
	config: DevkitConfig,
	accountIndex: number,
	chain: "evm" | "core",
): Promise<string> {
	try {
		const accounts = (await client.getAccounts(config)) as AccountInfo[];
		const account = accounts[accountIndex] ?? accounts[0];
		if (!account) return "";
		return chain === "core"
			? (account.coreAddress ?? "")
			: (account.evmAddress ?? "");
	} catch {
		return "";
	}
}

function getConstructorSchema(
	abi: unknown[],
): Array<{ name: string; type: string }> {
	if (!Array.isArray(abi)) {
		return [];
	}

	const constructorEntry = abi.find(
		(entry) =>
			typeof entry === "object" &&
			entry !== null &&
			"type" in entry &&
			(entry as { type?: unknown }).type === "constructor",
	) as { inputs?: Array<{ name?: string; type?: string }> } | undefined;

	return Array.isArray(constructorEntry?.inputs)
		? constructorEntry.inputs.map((input, index) => ({
				name: input.name?.trim() || `arg${index}`,
				type: input.type?.trim() || "unknown",
			}))
		: [];
}

/**
 * Infer a sensible default for a constructor arg based on its ABI type
 * and optionally its name.  Returns undefined when no default can be guessed.
 */
function inferTemplateArgDefault(
	argType: string,
	argName: string,
	defaultAddress: string,
): unknown | undefined {
	const t = argType.toLowerCase();
	const n = argName.toLowerCase();

	// address / address[] → deployer account
	if (t === "address") return defaultAddress;
	if (t === "address[]") return [defaultAddress];

	// uint / int variants → 0 (or 1 for "required" / threshold-like)
	if (/^u?int\d*$/.test(t)) {
		if (n === "required" || n === "threshold" || n === "quorum") return 1;
		if (n.includes("supply")) return 1000000;
		return 0;
	}

	// string → use arg name as a placeholder
	if (t === "string") {
		if (n === "name" || n === "tokenname") return "MyToken";
		if (n === "symbol" || n === "tokensymbol") return "MTK";
		return "";
	}

	// string[] → single-element placeholder
	if (t === "string[]") return ["Option A", "Option B"];

	// bool → false
	if (t === "bool") return false;

	// bytes / bytes32 → zero bytes
	if (t === "bytes32") return `0x${"0".repeat(64)}`;
	if (t === "bytes") return "0x";

	return undefined;
}

async function prepareTemplateDeployment(params: {
	client: DevkitClient;
	devkitCfg: DevkitConfig;
	contractName: string;
	providedArgs: unknown[];
	accountIndex?: number;
	chain?: "evm" | "core";
}): Promise<
	| {
			ok: true;
			template: Awaited<ReturnType<DevkitClient["getContractTemplate"]>>;
			constructorSchema: Array<{ name: string; type: string }>;
			resolvedArgs: unknown[];
			missingArgs: Array<{ index: number; name: string; type: string }>;
			extraArgs: number;
	  }
	| { ok: false; text: string }
> {
	const {
		client,
		devkitCfg,
		contractName,
		providedArgs,
		accountIndex = 0,
		chain = "evm",
	} = params;

	let template: Awaited<ReturnType<DevkitClient["getContractTemplate"]>>;
	try {
		template = await client.getContractTemplate(contractName, devkitCfg);
	} catch (err) {
		return {
			ok: false,
			text: [
				`❌ Unknown contract template: "${contractName}".`,
				`   Error: ${err instanceof Error ? err.message : String(err)}`,
				"",
				"Run conflux_templates to list valid names, then retry.",
			].join("\n"),
		};
	}

	const constructorSchema = getConstructorSchema(template.abi ?? []);
	const resolvedArgs: unknown[] = [];
	const missingArgs: Array<{ index: number; name: string; type: string }> = [];

	// Resolve the deployer address for auto-filling address args (chain-aware)
	const defaultAddress = await getDefaultAddressForChain(
		client,
		devkitCfg,
		accountIndex,
		chain,
	);

	for (let i = 0; i < constructorSchema.length; i += 1) {
		const supplied = providedArgs[i];
		if (isProvidedArg(supplied)) {
			resolvedArgs.push(supplied);
			continue;
		}

		// Try to infer a sensible default from the ABI type/name
		const inferred = inferTemplateArgDefault(
			constructorSchema[i].type,
			constructorSchema[i].name,
			defaultAddress,
		);
		if (inferred !== undefined) {
			resolvedArgs.push(inferred);
			continue;
		}

		missingArgs.push({ index: i, ...constructorSchema[i] });
	}

	const extraArgs =
		providedArgs.length > constructorSchema.length
			? providedArgs.length - constructorSchema.length
			: 0;

	return {
		ok: true,
		template,
		constructorSchema,
		resolvedArgs,
		missingArgs,
		extraArgs,
	};
}

async function prepareBootstrapDeployment(params: {
	client: DevkitClient;
	devkitCfg: DevkitConfig;
	contractName: string;
	providedArgs: unknown[];
	chain: "evm" | "core";
	accountIndex: number;
}): Promise<
	| {
			ok: true;
			entry: Awaited<ReturnType<DevkitClient["getBootstrapEntry"]>>;
			resolvedArgs: unknown[];
			missingArgs: Array<{
				index: number;
				name: string;
				type: string;
				description?: string;
			}>;
			extraArgs: number;
			defaultAddress: string;
			warnings: string[];
	  }
	| { ok: false; text: string }
> {
	const { client, devkitCfg, contractName, providedArgs, chain, accountIndex } =
		params;
	const warnings: string[] = [];

	let entry: Awaited<ReturnType<DevkitClient["getBootstrapEntry"]>>;
	try {
		entry = await client.getBootstrapEntry(contractName, devkitCfg);
	} catch (catalogErr) {
		return {
			ok: false,
			text: [
				`❌ Unknown bootstrap contract: "${contractName}".`,
				`   Error: ${catalogErr instanceof Error ? catalogErr.message : String(catalogErr)}`,
				"",
				"Run conflux_bootstrap_catalog to list valid names, then retry.",
			].join("\n"),
		};
	}

	if (entry.type === "precompile") {
		return {
			ok: false,
			text: `❌ ${contractName} is a precompile at ${entry.address ?? "a fixed address"} and cannot be deployed.`,
		};
	}

	if (entry.chains?.length && !entry.chains.includes(chain)) {
		// Align with extension deploy wizard: Core is allowed as a compatibility attempt
		// for deployable EVM contracts when ABI/bytecode is available.
		if (
			chain === "core" &&
			entry.chains.includes("evm") &&
			entry.abi &&
			entry.bytecode
		) {
			warnings.push(
				`${contractName} is not explicitly marked for core in catalog; attempting Core deploy via compatibility path.`,
			);
		} else {
			return {
				ok: false,
				text: `❌ ${contractName} does not support chain="${chain}". Supported chains: ${entry.chains.join(", ")}.`,
			};
		}
	}

	const defaultAddress = await getDefaultAddressForChain(
		client,
		devkitCfg,
		accountIndex,
		chain,
	);
	const { resolvedArgs, missingArgs, extraArgs } = buildBootstrapArgs({
		entry,
		providedArgs,
		defaultAddress,
	});

	return {
		ok: true,
		entry,
		resolvedArgs,
		missingArgs,
		extraArgs,
		defaultAddress,
		warnings,
	};
}

export async function handleConfluxContractsTool(params: {
	name: string;
	args: ToolArgs;
	devkitCfg: DevkitConfig;
	client: DevkitClient;
	saveContract: (entry: {
		name: string;
		address: string;
		chain: "evm" | "core";
		deployer: string;
		txHash?: string;
		constructorArgs: unknown[];
		deployedAt: string;
		chainId: number;
		abi?: unknown[];
	}) => Promise<unknown>;
	deployCoreFromCatalogBytecode: (params: {
		name: string;
		abi: unknown;
		bytecode: string;
		constructorArgs: unknown[];
		accountIndex: number;
	}) => Promise<{ text: string; isError?: boolean }>;
}): Promise<{
	content: Array<{ type: "text"; text: string }>;
	isError?: boolean;
} | null> {
	const {
		name,
		args: a,
		devkitCfg,
		client,
		saveContract: _saveContract,
		deployCoreFromCatalogBytecode,
	} = params;

	switch (name) {
		case "conflux_templates": {
			const templates = await client.getContractTemplates(devkitCfg);
			if (!templates.length) {
				return { content: [{ type: "text", text: "No templates available." }] };
			}
			const lines = templates.map(
				(t) => `• ${t.name.padEnd(20)} — ${t.description}`,
			);
			return { content: [{ type: "text", text: lines.join("\n") }] };
		}

		case "conflux_deploy": {
			const contractName = a.name as string;
			const rawArgs = a.args;
			if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
				return {
					content: [
						{
							type: "text",
							text: "❌ Invalid args: expected an array for `args`.",
						},
					],
					isError: true,
				};
			}

			const accountIndex = (a.accountIndex as number | undefined) ?? 0;
			const chain = (a.chain as "evm" | "core" | undefined) ?? "evm";
			const prep = await prepareTemplateDeployment({
				client,
				devkitCfg,
				contractName,
				providedArgs: (rawArgs as unknown[] | undefined) ?? [],
				accountIndex,
				chain,
			});
			if (!prep.ok) {
				return { content: [{ type: "text", text: prep.text }], isError: true };
			}

			const { constructorSchema, resolvedArgs, missingArgs, extraArgs } = prep;
			if (extraArgs > 0) {
				return {
					content: [
						{
							type: "text",
							text: [
								`❌ Too many constructor args for ${contractName}.`,
								`   Expected ${constructorSchema.length}, received ${((rawArgs as unknown[] | undefined) ?? []).length}.`,
								"",
								`Schema: ${constructorSchema.map((arg) => `${arg.name}:${arg.type}`).join(", ") || "(no args)"}`,
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			if (missingArgs.length > 0) {
				const previewArgs = constructorSchema.map((arg, index) => {
					const supplied = resolvedArgs[index];
					return supplied !== undefined
						? JSON.stringify(supplied)
						: `"<${arg.name}>"`;
				});
				return {
					content: [
						{
							type: "text",
							text: [
								`❌ Missing required constructor args for ${contractName}.`,
								...missingArgs.map(
									(arg) => `   - args[${arg.index}] ${arg.name}:${arg.type}`,
								),
								"",
								"Retry with all required args. Suggested call skeleton:",
								`conflux_deploy(name="${contractName}", args=[${previewArgs.join(", ")}])`,
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			const contractArgs = resolvedArgs;
			const contract = await client.deployContractTemplate(
				contractName,
				contractArgs,
				chain,
				accountIndex,
				devkitCfg,
			);

			// Show which args were auto-filled vs user-provided
			const argsSummary =
				constructorSchema.length === 0
					? "(no constructor args)"
					: constructorSchema
							.map((s, i) => {
								const val = contractArgs[i];
								const wasProvided = isProvidedArg(
									((rawArgs as unknown[] | undefined) ?? [])[i],
								);
								return `${s.name}: ${JSON.stringify(val)}${wasProvided ? "" : " (default)"}`;
							})
							.join(", ");

			return {
				content: [
					{
						type: "text",
						text: [
							"✅ Contract deployed and tracked in devkit contract registry",
							`Name:    ${contract.name ?? contractName}`,
							`Address: ${contract.address}`,
							`Chain:   ${chain === "evm" ? "eSpace" : "Core Space"}`,
							`Args:    ${argsSummary}`,
							`ID:      ${contract.id}`,
							"",
							"Use cfxdevkit_contract_call to read, cfxdevkit_contract_write to write (ABI auto-loaded).",
						].join("\n"),
					},
				],
			};
		}

		case "conflux_deploy_prepare": {
			const contractName = a.name as string;
			const rawArgs = a.args;
			if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
				return {
					content: [
						{
							type: "text",
							text: "❌ Invalid args: expected an array for `args`.",
						},
					],
					isError: true,
				};
			}

			const providedArgs = (rawArgs as unknown[] | undefined) ?? [];
			const prep = await prepareTemplateDeployment({
				client,
				devkitCfg,
				contractName,
				providedArgs,
				accountIndex: 0,
				chain: "evm",
			});
			if (!prep.ok) {
				return { content: [{ type: "text", text: prep.text }], isError: true };
			}

			const {
				template,
				constructorSchema,
				resolvedArgs,
				missingArgs,
				extraArgs,
			} = prep;
			const report = {
				ready: missingArgs.length === 0 && extraArgs === 0,
				name: contractName,
				abiAvailable: Array.isArray(template.abi),
				bytecodeAvailable:
					typeof template.bytecode === "string" && template.bytecode.length > 0,
				schemaArgCount: constructorSchema.length,
				providedArgCount: providedArgs.length,
				extraArgs,
				resolvedArgs,
				missingArgs,
				constructorSchema,
			};

			return {
				content: [
					{
						type: "text",
						text: [
							report.ready
								? "✅ Template deployment inputs are complete."
								: "❌ Template deployment inputs are incomplete.",
							JSON.stringify(report, null, 2),
							"",
							"If ready=true, run conflux_deploy with args=resolvedArgs.",
						].join("\n"),
					},
				],
				isError: !report.ready,
			};
		}

		case "conflux_contracts": {
			const contracts = await client.getDeployedContracts(devkitCfg);
			if (!contracts.length) {
				return {
					content: [{ type: "text", text: "No contracts deployed yet." }],
				};
			}
			const lines = contracts.map(
				(c) =>
					`• ${(c.name ?? c.id).padEnd(24)} ${c.chain.padEnd(5)} ${c.address}`,
			);
			return { content: [{ type: "text", text: lines.join("\n") }] };
		}

		case "conflux_bootstrap_catalog": {
			const catalog = await client.getBootstrapCatalog(devkitCfg);
			if (!catalog.length) {
				return {
					content: [
						{
							type: "text",
							text: "Bootstrap catalog empty or server offline.",
						},
					],
				};
			}
			const byCategory = new Map<string, typeof catalog>();
			for (const entry of catalog) {
				const cat = entry.category ?? "other";
				if (!byCategory.has(cat)) {
					byCategory.set(cat, []);
				}
				byCategory.get(cat)?.push(entry);
			}
			const lines: string[] = [];
			for (const [cat, entries] of byCategory) {
				lines.push(`[${cat}]`);
				for (const e of entries) {
					const note =
						e.type === "precompile" ? " (precompile, no deploy)" : "";
					const chainList = e.chains?.length
						? ` [chains: ${e.chains.join(", ")}]`
						: "";
					lines.push(
						`  • ${e.name.padEnd(22)} — ${e.description}${note}${chainList}`,
					);
					if (e.constructorArgs?.length) {
						lines.push(
							`    Args: ${e.constructorArgs.map((arg) => `${arg.name}:${arg.type}`).join(", ")}`,
						);
					}
				}
			}
			return { content: [{ type: "text", text: lines.join("\n") }] };
		}

		case "conflux_bootstrap_deploy": {
			const contractName = a.name as string;
			const rawArgs = a.args;
			if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
				return {
					content: [
						{
							type: "text",
							text: '❌ Invalid args: expected an array for `args` (e.g. args=["Token","TKN","18"]).',
						},
					],
					isError: true,
				};
			}
			const providedArgs = (rawArgs as unknown[] | undefined) ?? [];
			const chain = (a.chain as "evm" | "core" | undefined) ?? "evm";
			const accountIndex = (a.accountIndex as number | undefined) ?? 0;

			const prep = await prepareBootstrapDeployment({
				client,
				devkitCfg,
				contractName,
				providedArgs,
				chain,
				accountIndex,
			});
			if (!prep.ok) {
				return { content: [{ type: "text", text: prep.text }], isError: true };
			}

			const { entry, resolvedArgs, missingArgs, extraArgs, warnings } = prep;

			if (extraArgs > 0) {
				return {
					content: [
						{
							type: "text",
							text: [
								`❌ Too many constructor args for ${contractName}.`,
								`   Expected ${entry.constructorArgs.length}, received ${providedArgs.length}.`,
								"",
								`Schema: ${entry.constructorArgs.map((arg) => `${arg.name}:${arg.type}`).join(", ") || "(no args)"}`,
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			if (missingArgs.length > 0) {
				const previewArgs = entry.constructorArgs.map((arg, index) => {
					const val = resolvedArgs[index];
					if (val !== undefined) {
						return JSON.stringify(val);
					}
					return `"<${arg.name}>"`;
				});

				return {
					content: [
						{
							type: "text",
							text: [
								`❌ Missing required constructor args for ${contractName}.`,
								...missingArgs.map(
									(arg) =>
										`   - args[${arg.index}] ${arg.name}:${arg.type}${arg.description ? ` — ${arg.description}` : ""}`,
								),
								"",
								"Retry with all required args. Suggested call skeleton:",
								`conflux_bootstrap_deploy(name="${contractName}", chain="${chain}", args=[${previewArgs.join(", ")}], accountIndex=${accountIndex})`,
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			const contractArgs = resolvedArgs;

			let contract: Awaited<
				ReturnType<DevkitClient["deployBootstrapContract"]>
			>;
			try {
				contract = await client.deployBootstrapContract(
					contractName,
					contractArgs,
					chain,
					accountIndex,
					devkitCfg,
				);
			} catch (apiErr) {
				if (chain === "core") {
					if (entry?.abi && entry?.bytecode) {
						const coreResult = await deployCoreFromCatalogBytecode({
							name: contractName,
							abi: entry.abi,
							bytecode: entry.bytecode,
							constructorArgs: contractArgs,
							accountIndex,
						});
						return {
							content: [{ type: "text", text: coreResult.text }],
							isError: coreResult.isError,
						};
					}

					return {
						content: [
							{
								type: "text",
								text: [
									`❌ Bootstrap API rejected Core Space deployment for "${contractName}".`,
									`   Error: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`,
									"",
									"→ Deploy the same contract to Core using the eSpace ABI+bytecode:",
									`  1. conflux_bootstrap_deploy(name="${contractName}", args=[...], chain="evm")   ← get eSpace ABI`,
									`  2. blockchain_core_deploy_contract(abi=<ABI from step 1>, bytecode=<bytecode>, contractName="${contractName}", constructorArgs=[...], accountIndex=${accountIndex})`,
									"",
									"  ERC contracts are CRC-compatible — same bytecode deploys to Core Space.",
								].join("\n"),
							},
						],
						isError: true,
					};
				}
				throw apiErr;
			}

			return {
				content: [
					{
						type: "text",
						text: [
							"✅ Bootstrap contract deployed and tracked in devkit contract registry",
							`Name:    ${contract.name ?? contractName}`,
							`Address: ${contract.address}`,
							`Chain:   ${chain === "evm" ? "eSpace" : "Core Space"}`,
							`Args:    ${entry.constructorArgs.length === 0 ? "(no args)" : contractArgs.map((v, i) => `${entry.constructorArgs[i]?.name ?? i}: ${JSON.stringify(v)}`).join(", ")}`,
							`ID:      ${contract.id}`,
							...(warnings.length
								? ["", ...warnings.map((warning) => `⚠ ${warning}`)]
								: []),
							"",
							"Use cfxdevkit_contract_call to read, cfxdevkit_contract_write to write (ABI auto-loaded).",
						].join("\n"),
					},
				],
			};
		}

		case "conflux_bootstrap_deploy_multi": {
			const contractName = a.name as string;
			const rawArgs = a.args;
			if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
				return {
					content: [
						{
							type: "text",
							text: "❌ Invalid args: expected an array for `args`.",
						},
					],
					isError: true,
				};
			}

			const chains = Array.isArray(a.chains)
				? (a.chains as unknown[]).filter(
						(v): v is "evm" | "core" => v === "evm" || v === "core",
					)
				: [];
			if (chains.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: '❌ chains is required and must include at least one of: "evm", "core".',
						},
					],
					isError: true,
				};
			}

			const providedArgs = (rawArgs as unknown[] | undefined) ?? [];
			const chainArgsInput =
				(a.chainArgs as Record<string, unknown> | undefined) ?? {};
			const accountIndex = (a.accountIndex as number | undefined) ?? 0;
			const continueOnError =
				(a.continueOnError as boolean | undefined) ?? true;

			const seen = new Set<"evm" | "core">();
			const uniqueChains = chains.filter((c) => {
				if (seen.has(c)) return false;
				seen.add(c);
				return true;
			});

			const results: Array<Record<string, unknown>> = [];
			let hasFailure = false;

			for (const chain of uniqueChains) {
				const perChainArgsRaw = chainArgsInput[chain];
				const providedArgsForChain = Array.isArray(perChainArgsRaw)
					? perChainArgsRaw
					: providedArgs;

				const prep = await prepareBootstrapDeployment({
					client,
					devkitCfg,
					contractName,
					providedArgs: providedArgsForChain,
					chain,
					accountIndex,
				});

				if (!prep.ok) {
					hasFailure = true;
					results.push({
						chain,
						ok: false,
						stage: "prepare",
						error: prep.text,
					});
					if (!continueOnError) break;
					continue;
				}

				const { entry, resolvedArgs, missingArgs, extraArgs, warnings } = prep;

				if (extraArgs > 0) {
					hasFailure = true;
					results.push({
						chain,
						ok: false,
						stage: "prepare",
						error: `Too many constructor args. Expected ${entry.constructorArgs.length}, received ${providedArgsForChain.length}.`,
					});
					if (!continueOnError) break;
					continue;
				}

				if (missingArgs.length > 0) {
					hasFailure = true;
					results.push({
						chain,
						ok: false,
						stage: "prepare",
						error: "Missing required constructor args.",
						missingArgs,
					});
					if (!continueOnError) break;
					continue;
				}

				const constructorArgs = resolvedArgs;

				try {
					if (chain === "core") {
						try {
							const contract = await client.deployBootstrapContract(
								contractName,
								constructorArgs,
								chain,
								accountIndex,
								devkitCfg,
							);
							results.push({
								chain,
								ok: true,
								address: contract.address,
								txHash: contract.txHash ?? null,
								id: contract.id,
								via: "bootstrap-api",
								warnings,
							});
							continue;
						} catch {
							if (entry.abi && entry.bytecode) {
								const coreResult = await deployCoreFromCatalogBytecode({
									name: contractName,
									abi: entry.abi,
									bytecode: entry.bytecode,
									constructorArgs,
									accountIndex,
								});
								if (coreResult.isError) {
									throw new Error(coreResult.text);
								}
								results.push({
									chain,
									ok: true,
									via: "core-bytecode-fallback",
									note: coreResult.text,
									warnings,
								});
								continue;
							}
							throw new Error(
								"Core deploy failed and catalog entry has no ABI/bytecode fallback.",
							);
						}
					}

					const contract = await client.deployBootstrapContract(
						contractName,
						constructorArgs,
						chain,
						accountIndex,
						devkitCfg,
					);
					results.push({
						chain,
						ok: true,
						address: contract.address,
						txHash: contract.txHash ?? null,
						id: contract.id,
						via: "bootstrap-api",
						warnings,
					});
				} catch (err) {
					hasFailure = true;
					results.push({
						chain,
						ok: false,
						stage: "deploy",
						error: err instanceof Error ? err.message : String(err),
					});
					if (!continueOnError) break;
				}
			}

			const response = {
				name: contractName,
				accountIndex,
				continueOnError,
				requestedChains: uniqueChains,
				requestedArgCount: providedArgs.length,
				chainArgsProvided: {
					evm: Array.isArray(chainArgsInput.evm),
					core: Array.isArray(chainArgsInput.core),
				},
				ok: !hasFailure,
				results,
			};

			return {
				content: [{ type: "text", text: JSON.stringify(response, null, 2) }],
				isError: hasFailure,
			};
		}

		case "conflux_bootstrap_entry": {
			const contractName = a.name as string;
			const accountIndex = (a.accountIndex as number | undefined) ?? 0;
			let entry: Awaited<ReturnType<DevkitClient["getBootstrapEntry"]>>;
			try {
				entry = await client.getBootstrapEntry(contractName, devkitCfg);
			} catch (err) {
				return {
					content: [
						{
							type: "text",
							text: [
								`❌ Unknown bootstrap contract: "${contractName}".`,
								`   Error: ${err instanceof Error ? err.message : String(err)}`,
								"",
								"Run conflux_bootstrap_catalog to list valid names.",
							].join("\n"),
						},
					],
					isError: true,
				};
			}

			const evmAddress = await getDefaultAddressForChain(
				client,
				devkitCfg,
				accountIndex,
				"evm",
			);
			const coreAddress = await getDefaultAddressForChain(
				client,
				devkitCfg,
				accountIndex,
				"core",
			);
			const schema = entry.constructorArgs ?? [];
			const argLines = schema.length
				? schema.map((arg, index) => {
						const evmFallback = argDefault(arg.placeholder, evmAddress);
						const coreFallback = argDefault(arg.placeholder, coreAddress);
						const isAddress =
							arg.type === "address" ||
							arg.type === "address[]" ||
							/^0x/.test(arg.placeholder ?? "");
						const fallbackNote = evmFallback
							? isAddress
								? ` | eSpace default=${JSON.stringify(evmFallback)}, Core default=${JSON.stringify(coreFallback)}`
								: ` | default=${JSON.stringify(evmFallback)}`
							: " | required";
						return `  ${index}. ${arg.name}:${arg.type} — ${arg.description ?? ""}${fallbackNote}`;
					})
				: ["  (no constructor args)"];

			return {
				content: [
					{
						type: "text",
						text: [
							`name: ${entry.name}`,
							`category: ${entry.category}`,
							`type: ${entry.type ?? "deployable"}`,
							`chains: ${entry.chains.join(", ")}`,
							`description: ${entry.description}`,
							`abiAvailable: ${entry.abi ? "yes" : "no"}`,
							`bytecodeAvailable: ${entry.bytecode ? "yes" : "no"}`,
							entry.address ? `address: ${entry.address}` : null,
							"",
							"constructorArgs:",
							...argLines,
							"",
							"NOTE: Address args use different formats per chain.",
							`  eSpace deployer (0x): ${evmAddress}`,
							`  Core deployer (base32): ${coreAddress}`,
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
			};
		}

		case "conflux_bootstrap_prepare": {
			const contractName = a.name as string;
			const rawArgs = a.args;
			if (rawArgs !== undefined && !Array.isArray(rawArgs)) {
				return {
					content: [
						{
							type: "text",
							text: "❌ Invalid args: expected an array for `args`.",
						},
					],
					isError: true,
				};
			}

			const providedArgs = (rawArgs as unknown[] | undefined) ?? [];
			const chain = (a.chain as "evm" | "core" | undefined) ?? "evm";
			const accountIndex = (a.accountIndex as number | undefined) ?? 0;

			const prep = await prepareBootstrapDeployment({
				client,
				devkitCfg,
				contractName,
				providedArgs,
				chain,
				accountIndex,
			});
			if (!prep.ok) {
				return { content: [{ type: "text", text: prep.text }], isError: true };
			}

			const { entry, resolvedArgs, missingArgs, extraArgs, defaultAddress } =
				prep;
			const ready = missingArgs.length === 0 && extraArgs === 0;
			const report = {
				ready,
				name: contractName,
				chain,
				accountIndex,
				schemaArgCount: entry.constructorArgs.length,
				providedArgCount: providedArgs.length,
				extraArgs,
				defaultAddress,
				resolvedArgs,
				missingArgs,
			};

			return {
				content: [
					{
						type: "text",
						text: [
							ready
								? "✅ Deployment inputs are complete."
								: "❌ Deployment inputs are incomplete.",
							JSON.stringify(report, null, 2),
							"",
							"If ready=true, run conflux_bootstrap_deploy with args=resolvedArgs.",
						].join("\n"),
					},
				],
				isError: !ready,
			};
		}

		default:
			return null;
	}
}

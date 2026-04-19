import {
	Button,
	SectionHeader,
	SelectableListItem,
	StatusBanner,
} from "@devkit/ui-shared";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DexState } from "../hooks/useDex";
import {
	fetchKnownTokenCatalog,
	fetchTokenIconOverrides,
	type KnownTokenEntry,
	normalizeAddress,
	saveTokenIconOverride,
	type TokenIconOverrideEntry,
	uploadTokenIcon,
} from "../lib/knownTokens";

interface Props {
	dex: DexState;
}

interface IconManagerItem {
	canonicalAddress: string;
	symbol: string;
	name: string;
	iconUrl?: string;
	overrideIconUrl?: string;
	publicAddress: string | null;
	localAddresses: string[];
	source: "catalog" | "runtime" | "merged";
}

function getCanonicalAddress(token: {
	address: string;
	realAddress?: string | null;
}): string {
	return normalizeAddress(token.realAddress ?? token.address);
}

function buildItems(
	knownTokens: Map<string, KnownTokenEntry>,
	overrides: Map<string, TokenIconOverrideEntry>,
	dex: DexState,
): IconManagerItem[] {
	const items = new Map<string, IconManagerItem>();

	for (const token of knownTokens.values()) {
		const canonicalAddress = normalizeAddress(token.address);
		items.set(canonicalAddress, {
			canonicalAddress,
			symbol: token.symbol,
			name: token.name,
			iconUrl: token.iconUrl ?? undefined,
			overrideIconUrl: overrides.get(canonicalAddress)?.iconUrl,
			publicAddress: canonicalAddress,
			localAddresses: [],
			source: "catalog",
		});
	}

	for (const token of dex.tokens) {
		const canonicalAddress = getCanonicalAddress(token);
		const existing = items.get(canonicalAddress);
		const tokenAddress = normalizeAddress(token.address);
		const realAddress = token.realAddress
			? normalizeAddress(token.realAddress)
			: null;
		const publicAddress =
			existing?.publicAddress ??
			realAddress ??
			(tokenAddress === canonicalAddress ? canonicalAddress : null);
		const localAddresses = new Set(existing?.localAddresses ?? []);
		if (tokenAddress !== publicAddress) {
			localAddresses.add(tokenAddress);
		}
		if (realAddress && realAddress !== publicAddress) {
			localAddresses.add(realAddress);
		}

		items.set(canonicalAddress, {
			canonicalAddress,
			symbol: existing?.symbol ?? token.symbol,
			name:
				existing?.name ??
				(token.isNative ? "Native Wrapped Asset" : "Local Token"),
			iconUrl: token.iconUrl ?? existing?.iconUrl,
			overrideIconUrl:
				overrides.get(canonicalAddress)?.iconUrl ?? existing?.overrideIconUrl,
			publicAddress,
			localAddresses: [...localAddresses].sort(),
			source: existing ? "merged" : "runtime",
		});
	}

	return [...items.values()].sort((left, right) => {
		const symbolCompare = left.symbol.localeCompare(right.symbol);
		if (symbolCompare !== 0) return symbolCompare;
		return left.canonicalAddress.localeCompare(right.canonicalAddress);
	});
}

export function TokenIconManager({ dex }: Props) {
	const [knownTokens, setKnownTokens] = useState<Map<string, KnownTokenEntry>>(
		new Map(),
	);
	const [overrides, setOverrides] = useState<
		Map<string, TokenIconOverrideEntry>
	>(new Map());
	const [selectedAddress, setSelectedAddress] = useState("");
	const [search, setSearch] = useState("");
	const [iconUrlInput, setIconUrlInput] = useState("");
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState("");
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const overrideInputId = "token-icon-override-url";

	useEffect(() => {
		let cancelled = false;
		setLoading(true);
		void Promise.all([fetchKnownTokenCatalog(), fetchTokenIconOverrides()])
			.then(([catalog, iconOverrides]) => {
				if (cancelled) return;
				setKnownTokens(catalog);
				setOverrides(iconOverrides);
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				setStatus(
					error instanceof Error ? error.message : "Failed to load token icons",
				);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, []);

	const items = useMemo(
		() => buildItems(knownTokens, overrides, dex),
		[knownTokens, overrides, dex],
	);

	const filteredItems = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return items;
		return items.filter(
			(item) =>
				item.symbol.toLowerCase().includes(query) ||
				item.name.toLowerCase().includes(query) ||
				item.canonicalAddress.includes(query) ||
				(item.publicAddress?.includes(query) ?? false) ||
				item.localAddresses.some((address) => address.includes(query)),
		);
	}, [items, search]);

	const selectedItem = useMemo(
		() =>
			filteredItems.find((item) => item.canonicalAddress === selectedAddress) ??
			items.find((item) => item.canonicalAddress === selectedAddress) ??
			filteredItems[0] ??
			items[0],
		[filteredItems, items, selectedAddress],
	);

	useEffect(() => {
		if (!selectedItem) return;
		setSelectedAddress(selectedItem.canonicalAddress);
		setIconUrlInput(selectedItem.overrideIconUrl ?? selectedItem.iconUrl ?? "");
	}, [selectedItem]);

	const persistOverride = async (value: string | null) => {
		if (!selectedItem) return;
		setSaving(true);
		setStatus("Saving override...");
		try {
			await saveTokenIconOverride(selectedItem.canonicalAddress, value);
			const nextOverrides = await fetchTokenIconOverrides();
			setOverrides(nextOverrides);
			setIconUrlInput(value ?? "");
			setStatus(value ? "Override saved" : "Override removed");
			dex.refresh();
		} catch (error) {
			setStatus(
				error instanceof Error ? error.message : "Failed to save override",
			);
		} finally {
			setSaving(false);
		}
	};

	const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		if (!file || !selectedItem) return;
		setSaving(true);
		setStatus("Uploading icon...");
		try {
			const uploaded = await uploadTokenIcon(
				selectedItem.canonicalAddress,
				file,
			);
			await persistOverride(uploaded.iconUrl);
			setStatus("Uploaded icon and saved override");
		} catch (error) {
			setStatus(
				error instanceof Error ? error.message : "Failed to upload icon",
			);
			setSaving(false);
		} finally {
			event.target.value = "";
		}
	};

	const activeIconUrl =
		selectedItem?.overrideIconUrl ?? selectedItem?.iconUrl ?? "";

	return (
		<div className="rounded-[2rem] border border-white/5 bg-bg-secondary/40 p-6 md:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden">
			<div className="absolute bottom-0 left-0 -mb-20 -ml-20 h-64 w-64 rounded-full bg-success/5 blur-[90px] pointer-events-none opacity-20" />

			<input
				ref={fileInputRef}
				type="file"
				accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
				className="hidden"
				onChange={(event) => void handleUpload(event)}
			/>

			<SectionHeader
				className="px-1 sm:items-end"
				title="Icon Control"
				description="Manage canonical token artwork across catalog entries, mirror tokens, and local-only assets."
				right={
					<div className="text-[8px] font-black uppercase tracking-[0.25em] text-text-secondary/30 italic">
						{items.length} canonical tokens indexed
					</div>
				}
			/>

			<div className="relative grid items-stretch gap-5 xl:min-h-[680px] xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
				<div className="flex h-[70vh] max-h-[680px] min-h-[560px] flex-col rounded-2xl border border-white/5 bg-white/[0.02] p-4 shadow-inner">
					<input
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search symbol, name, or address"
						className="w-full rounded-xl border border-white/10 bg-bg-primary/70 px-3 py-2 text-sm text-white outline-none transition focus:border-accent/40"
					/>

					<div className="mt-4 min-h-0 flex-1 overflow-auto pr-1">
						<div className="grid gap-2">
							{filteredItems.map((item) => {
								const icon = item.overrideIconUrl ?? item.iconUrl;
								const active =
									selectedItem?.canonicalAddress === item.canonicalAddress;
								return (
									<SelectableListItem
										key={item.canonicalAddress}
										active={active}
										onClick={() => setSelectedAddress(item.canonicalAddress)}
										icon={
											<div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
												{icon ? (
													<img
														src={icon}
														alt={item.symbol}
														className="h-8 w-8 object-contain"
													/>
												) : (
													<span className="text-[9px] font-black uppercase tracking-[0.18em] text-text-secondary/40">
														None
													</span>
												)}
											</div>
										}
										title={item.symbol}
										subtitle={item.name}
										meta={`${item.source} • ${(item.publicAddress ? 1 : 0) + item.localAddresses.length} addr`}
									/>
								);
							})}
							{!filteredItems.length && (
								<div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary/35">
									No tokens matched
								</div>
							)}
						</div>
					</div>
				</div>

				<div className="h-full rounded-2xl border border-white/5 bg-white/[0.02] p-5 shadow-inner">
					{!selectedItem ? (
						<div className="flex min-h-[280px] items-center justify-center text-[10px] font-black uppercase tracking-[0.16em] text-text-secondary/35">
							{loading ? "Loading token catalog..." : "Select a token"}
						</div>
					) : (
						<div className="grid gap-5">
							<div className="flex flex-col gap-4 lg:flex-row lg:items-center">
								<div className="flex h-20 w-20 items-center justify-center rounded-[1.75rem] border border-white/10 bg-bg-primary/60">
									{activeIconUrl ? (
										<img
											src={activeIconUrl}
											alt={selectedItem.symbol}
											className="h-14 w-14 object-contain"
										/>
									) : (
										<span className="text-[10px] font-black uppercase tracking-[0.18em] text-text-secondary/35">
											No Icon
										</span>
									)}
								</div>

								<div className="min-w-0 flex-1">
									<div className="text-xl font-black uppercase tracking-tight text-white">
										{selectedItem.symbol}
									</div>
									<div className="mt-1 text-xs font-medium italic text-text-secondary/60">
										{selectedItem.name}
									</div>
									<div className="mt-3 rounded-xl border border-white/5 bg-bg-primary/40 px-3 py-2 text-[10px] font-black tracking-[0.12em] text-text-secondary/45">
										{selectedItem.canonicalAddress}
									</div>
								</div>
							</div>

							<div className="grid gap-3">
								<label
									htmlFor={overrideInputId}
									className="text-[8px] font-black uppercase tracking-[0.28em] text-text-secondary/30"
								>
									Override URL
								</label>
								<input
									id={overrideInputId}
									value={iconUrlInput}
									onChange={(event) => setIconUrlInput(event.target.value)}
									placeholder="https://..."
									className="w-full rounded-2xl border border-white/10 bg-bg-primary/70 px-4 py-3 text-sm text-white outline-none transition focus:border-accent/40"
								/>
								<div className="text-[10px] leading-relaxed text-text-secondary/50">
									Save a direct URL or upload a local file. The override is
									stored on the canonical token address and applies to related
									mirror/runtime addresses automatically.
								</div>
							</div>

							<div className="grid gap-3 md:grid-cols-2">
								<div className="rounded-2xl border border-white/5 bg-bg-primary/35 px-4 py-4">
									<div className="text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/30">
										Catalog Icon
									</div>
									<div className="mt-2 break-all text-[10px] font-medium text-text-secondary/55">
										{selectedItem.iconUrl ?? "None"}
									</div>
								</div>
								<div className="rounded-2xl border border-white/5 bg-bg-primary/35 px-4 py-4">
									<div className="text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/30">
										Active Override
									</div>
									<div className="mt-2 break-all text-[10px] font-medium text-text-secondary/55">
										{selectedItem.overrideIconUrl ?? "None"}
									</div>
								</div>
							</div>

							<div className="rounded-2xl border border-white/5 bg-bg-primary/35 px-4 py-4">
								<div className="text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/30">
									Related Addresses
								</div>
								<div className="mt-3 grid gap-3">
									<div className="rounded-xl border border-white/5 bg-bg-primary/40 px-3 py-3">
										<div className="text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/30">
											Public Address
										</div>
										<div className="mt-2 break-all text-[10px] font-medium text-text-secondary/55">
											{selectedItem.publicAddress ??
												"Not linked to a public canonical token"}
										</div>
									</div>
									<div className="rounded-xl border border-white/5 bg-bg-primary/40 px-3 py-3">
										<div className="text-[8px] font-black uppercase tracking-[0.24em] text-text-secondary/30">
											Local Address
											{selectedItem.localAddresses.length === 1 ? "" : "es"}
										</div>
										<div className="mt-2 grid gap-2">
											{selectedItem.localAddresses.length > 0 ? (
												selectedItem.localAddresses.map((address) => (
													<div
														key={address}
														className="break-all text-[10px] font-medium text-text-secondary/55"
													>
														{address}
													</div>
												))
											) : (
												<div className="text-[10px] font-medium text-text-secondary/40">
													No local mirror address recorded
												</div>
											)}
										</div>
									</div>
								</div>
							</div>

							<div className="flex flex-wrap gap-3">
								<Button
									onClick={() =>
										void persistOverride(iconUrlInput.trim() || null)
									}
									disabled={saving || !selectedItem.canonicalAddress}
								>
									{saving ? "Saving…" : "Save Override"}
								</Button>
								<Button
									variant="secondary"
									onClick={() => fileInputRef.current?.click()}
									disabled={saving || !selectedItem.canonicalAddress}
								>
									Upload Icon
								</Button>
								<Button
									variant="secondary"
									onClick={() => void persistOverride(null)}
									disabled={saving || !selectedItem.overrideIconUrl}
								>
									Remove Override
								</Button>
							</div>

							{status && (
								<StatusBanner
									message={status}
									tone={
										status.toLowerCase().includes("fail") ||
										status.toLowerCase().includes("error")
											? "error"
											: status.toLowerCase().includes("saved") ||
													status.toLowerCase().includes("uploaded") ||
													status.toLowerCase().includes("removed")
												? "success"
												: "accent"
									}
									className="rounded-2xl bg-bg-primary/35 text-text-secondary/45"
									textClassName="text-[10px] tracking-[0.16em]"
								/>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

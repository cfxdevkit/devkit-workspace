/**
 * views/network.ts
 *
 * TreeDataProvider for the "Network" sidebar view.
 * Shows a radio-button style list of available Conflux networks.
 *
 * Structure:
 *   ● Local (dev)        ← filled circle = currently selected
 *   ○ Testnet
 *   ○ Mainnet
 */

import * as vscode from "vscode";
import {
	NETWORK_CONFIGS,
	type NetworkSelection,
	networkState,
} from "./network-state";

class NetworkItem extends vscode.TreeItem {
	constructor(
		readonly networkId: NetworkSelection,
		readonly isSelected: boolean,
	) {
		const cfg = NETWORK_CONFIGS[networkId];
		super(
			isSelected ? `${cfg.label}` : `${cfg.label}`,
			vscode.TreeItemCollapsibleState.None,
		);
		let iconName = "circle-large-outline";
		if (networkId === "local")
			iconName = isSelected ? "server-environment" : "server";
		else if (networkId === "testnet") iconName = "beaker";
		else if (networkId === "mainnet") iconName = "globe";

		const colorId = isSelected ? "testing.iconPassed" : "descriptionForeground";

		this.description = "";
		this.iconPath = new vscode.ThemeIcon(
			iconName,
			new vscode.ThemeColor(colorId),
		);
		this.tooltip = `${cfg.label}\nCore chainId: ${cfg.coreChainId}  eSpace chainId: ${cfg.espaceChainId}`;
		this.contextValue = isSelected ? "cfxNetworkSelected" : "cfxNetworkOption";
		if (!isSelected) {
			this.command = {
				command: "cfxdevkit.selectNetwork",
				title: `Switch to ${cfg.label}`,
				arguments: [networkId],
			};
		}
	}
}

export class NetworkProvider
	implements vscode.TreeDataProvider<vscode.TreeItem>
{
	private _onDidChangeTreeData = new vscode.EventEmitter<
		vscode.TreeItem | undefined
	>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor() {
		networkState.onDidChange(() => this.refresh());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire(undefined);
	}

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(
		element?: vscode.TreeItem,
	): vscode.ProviderResult<vscode.TreeItem[]> {
		if (element) return [];
		const selected = networkState.selected;
		return (["local", "testnet", "mainnet"] as NetworkSelection[]).map(
			(id) => new NetworkItem(id, id === selected),
		);
	}
}

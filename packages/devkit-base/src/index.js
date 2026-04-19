export const sharedArtifacts = {
	mcp: "artifacts/devkit-mcp.tgz",
	config: "artifacts/config",
};

export const bakedInfrastructure = {
	backendPackage: "packages/devkit-backend",
	extensionPackage: "packages/vscode-extension",
	extensionArtifact: "dist/devkit.vsix",
};

if (process.argv[1]?.endsWith("/index.js")) {
	console.log(
		JSON.stringify({ sharedArtifacts, bakedInfrastructure }, null, 2),
	);
}

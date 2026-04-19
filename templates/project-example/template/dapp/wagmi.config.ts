import { resolve } from "node:path";
import { defineConfig } from "@wagmi/cli/config";
import { actions, react } from "@wagmi/cli/plugins";

const artifactPath = resolve(
	import.meta.dirname,
	"..",
	"contracts",
	"generated",
	"example-counter.js",
);

const { exampleCounterArtifact: artifact } = await import(artifactPath);

export default defineConfig({
	out: "src/generated/hooks.ts",
	contracts: [
		{
			name: artifact.contractName,
			abi: artifact.abi as never,
		},
	],
	plugins: [actions({ overridePackageName: "wagmi" }), react()],
});

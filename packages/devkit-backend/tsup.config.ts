import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		cli: "src/cli.ts",
	},
	format: ["cjs"],
	dts: false,
	clean: true,
	sourcemap: false,
	splitting: false,
	minify: false,
	target: "node20",
	banner: {
		js: "#!/usr/bin/env node",
	},
	noExternal: [/^@cfxdevkit\//, /^@devkit\//],
});

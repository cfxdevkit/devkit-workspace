import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Which path prefix is used when running behind code-server proxy.
// Set via: VITE_PROXY_BASE=/proxy/3001/ pnpm dev
const proxyBase = process.env.VITE_PROXY_BASE;

export default defineConfig({
	base: proxyBase ?? "./",
	plugins: [react()],
	resolve: {
		dedupe: ["react", "react-dom", "wagmi", "viem"],
	},
	server: {
		host: "0.0.0.0",
		port: 3001,
		strictPort: true,
		allowedHosts: "all",
	},
});

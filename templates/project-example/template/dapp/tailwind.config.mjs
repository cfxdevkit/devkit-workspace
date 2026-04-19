/** @type {import('tailwindcss').Config} */
export default {
	content: [
		"./index.html",
		"./src/**/*.{js,ts,jsx,tsx}",
		"../ui-shared/src/**/*.{js,ts,jsx,tsx}",
	],
	theme: {
		extend: {
			fontFamily: {
				sans: ["Inter", "system-ui", "sans-serif"],
				mono: ['"JetBrains Mono"', "monospace"],
			},
			colors: {
				bg: {
					primary: "#0f1117",
					secondary: "#1a1d27",
					tertiary: "#22253a",
				},
				border: {
					DEFAULT: "#2a2d3a",
					hover: "#3a3d4a",
					focus: "#4f8eff",
				},
				accent: {
					DEFAULT: "#4f8eff",
					hover: "#6ba0ff",
				},
				text: {
					primary: "#e1e4eb",
					secondary: "#8b8fa3",
				},
				success: "#34d399",
				warning: "#f5a623",
				error: "#f87171",
			},
		},
	},
	plugins: [],
};

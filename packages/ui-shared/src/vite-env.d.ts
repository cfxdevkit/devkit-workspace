interface ImportMetaEnv {
	readonly BASE_URL: string;
	readonly VITE_ENABLE_SIWE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

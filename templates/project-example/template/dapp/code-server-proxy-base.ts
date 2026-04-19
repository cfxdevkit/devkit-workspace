import type { Plugin } from "vite";

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
	return prefixes.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

export function codeServerProxyBasePlugin(
	proxyBase: string | undefined,
	passthroughPrefixes: string[],
): Plugin | null {
	if (!proxyBase) return null;

	const normalizedBase = proxyBase.endsWith("/") ? proxyBase : `${proxyBase}/`;

	return {
		name: "code-server-proxy-base",
		configureServer(server) {
			server.middlewares.use((req, _res, next) => {
				const url = req.url ?? "/";

				if (matchesPrefix(url, passthroughPrefixes)) {
					next();
					return;
				}

				if (url.startsWith(normalizedBase)) {
					const proxiedPath = `/${url.slice(normalizedBase.length).replace(/^\/+/, "")}`;
					if (matchesPrefix(proxiedPath, passthroughPrefixes)) {
						req.url = proxiedPath;
					}
					next();
					return;
				}

				req.url = `${normalizedBase}${url.replace(/^\/+/, "")}`;
				next();
			});
		},
	};
}

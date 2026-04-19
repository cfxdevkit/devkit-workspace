export function appBasePath(): string {
	if (typeof window === "undefined") {
		return import.meta.env.BASE_URL;
	}

	const match = window.location.pathname.match(/^(.*\/proxy\/\d+\/)/);
	if (match) {
		return match[1];
	}

	return import.meta.env.BASE_URL;
}

export function isLocalRuntime(): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const { hostname, pathname } = window.location;
	return (
		hostname === "localhost" ||
		hostname === "127.0.0.1" ||
		/^(.*\/proxy\/\d+\/)/.test(pathname)
	);
}

export function isHostedRuntime(): boolean {
	return !isLocalRuntime();
}

export function appUrl(path: string): string {
	return `${appBasePath()}${path.replace(/^\/+/, "")}`;
}

export function appAbsoluteUrl(path: string): string {
	const relativePath = appUrl(path);
	if (typeof window === "undefined") {
		return relativePath;
	}

	return new URL(relativePath, window.location.origin).toString();
}

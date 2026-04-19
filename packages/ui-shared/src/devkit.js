export function describeTargetFeatures(features) {
	return [
		{
			key: "baseUrl",
			label: "Base URL aware",
			enabled: Boolean(features?.baseUrl),
		},
		{ key: "proxy", label: "Proxy aware", enabled: Boolean(features?.proxy) },
		{
			key: "codeServer",
			label: "code-server runtime",
			enabled: Boolean(features?.codeServer),
		},
	];
}

export function featureFlagLabel(enabled) {
	return enabled ? "enabled" : "disabled";
}

export function resolveBaseUrlMode(features) {
	if (features?.proxy && features?.baseUrl) {
		return "proxy-aware";
	}

	if (features?.baseUrl) {
		return "base-url-aware";
	}

	return "direct";
}

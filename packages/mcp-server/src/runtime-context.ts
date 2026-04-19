import { existsSync } from "node:fs";
import { join } from "node:path";

export type RuntimeContext = {
	cwd: string;
	runtimeMode: string;
	workspaceRoot: string;
	projectRoot: string;
	backendBaseUrl: string;
	composeFile?: string;
	composeCandidates: string[];
	source: "env" | "argument" | "cwd" | "default";
};

const DEFAULT_BACKEND_BASE_URL = "http://127.0.0.1:7748";
const COMPOSE_CANDIDATES = [
	"docker-compose.yml",
	"project-example/docker-compose.yml",
];

function readNonEmptyEnv(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function inferRuntimeMode(cwd: string): string {
	if (cwd.endsWith("/project-example")) {
		return "workspace-container";
	}
	return "repo-root";
}

function resolveComposeFile(
	cwd: string,
	explicitComposeFile?: string,
): {
	composeFile?: string;
	source: RuntimeContext["source"];
	composeCandidates: string[];
} {
	if (explicitComposeFile && explicitComposeFile.trim().length > 0) {
		return {
			composeFile: explicitComposeFile,
			source: "argument",
			composeCandidates: COMPOSE_CANDIDATES.filter((candidate) =>
				existsSync(join(cwd, candidate)),
			),
		};
	}

	const envComposeFile = readNonEmptyEnv("CFXDEVKIT_COMPOSE_FILE");
	if (envComposeFile) {
		return {
			composeFile: envComposeFile,
			source: "env",
			composeCandidates: COMPOSE_CANDIDATES.filter((candidate) =>
				existsSync(join(cwd, candidate)),
			),
		};
	}

	const composeCandidates = COMPOSE_CANDIDATES.filter((candidate) =>
		existsSync(join(cwd, candidate)),
	);
	if (composeCandidates.length > 0) {
		return {
			composeFile: composeCandidates[0],
			source: "cwd",
			composeCandidates,
		};
	}

	return {
		composeFile: undefined,
		source: "default",
		composeCandidates,
	};
}

export function getWorkspaceContext(
	explicitComposeFile?: string,
): RuntimeContext {
	const cwd = process.cwd();
	const workspaceRoot = readNonEmptyEnv("CFXDEVKIT_AGENT_WORKSPACE") ?? cwd;
	const projectRoot =
		readNonEmptyEnv("CFXDEVKIT_PROJECT_ROOT") ?? workspaceRoot;
	const backendBaseUrl =
		readNonEmptyEnv("CFXDEVKIT_BACKEND_URL") ?? DEFAULT_BACKEND_BASE_URL;
	const runtimeMode =
		readNonEmptyEnv("CFXDEVKIT_RUNTIME_MODE") ?? inferRuntimeMode(cwd);
	const compose = resolveComposeFile(cwd, explicitComposeFile);

	return {
		cwd,
		runtimeMode,
		workspaceRoot,
		projectRoot,
		backendBaseUrl,
		composeFile: compose.composeFile,
		composeCandidates: compose.composeCandidates,
		source:
			compose.source === "env" ||
			readNonEmptyEnv("CFXDEVKIT_RUNTIME_MODE") ||
			readNonEmptyEnv("CFXDEVKIT_AGENT_WORKSPACE")
				? "env"
				: compose.source,
	};
}

export function resolveDevkitPort(
	context: RuntimeContext,
	explicitPort?: number,
): number | undefined {
	if (typeof explicitPort === "number" && Number.isFinite(explicitPort)) {
		return explicitPort;
	}

	try {
		const url = new URL(context.backendBaseUrl);
		const parsed = Number(url.port || "");
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 7748;
	} catch {
		return 7748;
	}
}

export function isWorkspaceContainerContext(context: RuntimeContext): boolean {
	return context.runtimeMode === "workspace-container";
}

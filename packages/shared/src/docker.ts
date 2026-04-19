import { execFileSync, execSync, spawnSync } from "node:child_process";

export interface ComposeOptions {
	composeFile?: string;
	projectName?: string;
	cwd?: string;
}

export interface ComposeStatus {
	running: boolean;
	services: ServiceStatus[];
	raw: string;
}

export interface ServiceStatus {
	name: string;
	state: "running" | "exited" | "paused" | "unknown";
	ports: string;
}

function buildComposeArgs(opts: ComposeOptions): string[] {
	const args: string[] = [];
	if (opts.composeFile) {
		args.push("-f", opts.composeFile);
	}
	if (opts.projectName) {
		args.push("-p", opts.projectName);
	}
	return args;
}

type ComposeCommand = {
	runtime: "docker" | "podman";
	command: string;
	baseArgs: string[];
};

function commandExists(cmd: string): boolean {
	const lookup = process.platform === "win32" ? "where" : "which";
	try {
		execFileSync(lookup, [cmd], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function resolveComposeCommand(): ComposeCommand {
	const forcedRuntime = process.env.CFXDEVKIT_RUNTIME?.trim().toLowerCase();

	if (forcedRuntime === "podman") {
		if (commandExists("podman-compose")) {
			return {
				runtime: "podman",
				command: "podman-compose",
				baseArgs: ["--podman-run-args=--userns=keep-id"],
			};
		}
		return { runtime: "podman", command: "podman", baseArgs: ["compose"] };
	}

	if (forcedRuntime === "docker") {
		return { runtime: "docker", command: "docker", baseArgs: ["compose"] };
	}

	if (commandExists("podman") && commandExists("podman-compose")) {
		return {
			runtime: "podman",
			command: "podman-compose",
			baseArgs: ["--podman-run-args=--userns=keep-id"],
		};
	}
	if (commandExists("podman")) {
		return { runtime: "podman", command: "podman", baseArgs: ["compose"] };
	}
	return { runtime: "docker", command: "docker", baseArgs: ["compose"] };
}

/** Run docker/podman compose and return stdout. Throws on non-zero exit. */
export function runCompose(
	subcommand: string[],
	opts: ComposeOptions = {},
): string {
	const compose = resolveComposeCommand();
	const baseArgs = buildComposeArgs(opts);
	const allArgs = [...compose.baseArgs, ...baseArgs, ...subcommand];
	const result = spawnSync(compose.command, allArgs, {
		cwd: opts.cwd ?? process.cwd(),
		encoding: "utf-8",
		timeout: 30_000,
		env:
			compose.runtime === "podman"
				? {
						...process.env,
						PODMAN_USERNS: process.env.PODMAN_USERNS ?? "keep-id",
					}
				: process.env,
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			result.stderr ||
				`${compose.command} compose exited with ${result.status}`,
		);
	}
	return result.stdout ?? "";
}

/** Get status of all compose services. Does not throw — returns empty on error. */
export function getComposeStatus(opts: ComposeOptions = {}): ComposeStatus {
	try {
		const raw = runCompose(["ps", "--format", "json"], opts);
		// docker compose ps --format json outputs one JSON object per line
		const services: ServiceStatus[] = raw
			.split("\n")
			.filter(Boolean)
			.map((line) => {
				try {
					const obj = JSON.parse(line) as {
						Name?: string;
						State?: string;
						Publishers?: { PublishedPort: number; TargetPort: number }[];
					};
					const ports = (obj.Publishers ?? [])
						.filter((p) => p.PublishedPort)
						.map((p) => `${p.PublishedPort}->${p.TargetPort}`)
						.join(", ");
					const state = (
						["running", "exited", "paused"].includes(obj.State ?? "")
							? obj.State
							: "unknown"
					) as ServiceStatus["state"];
					return { name: obj.Name ?? "unknown", state, ports };
				} catch {
					return { name: "unknown", state: "unknown" as const, ports: "" };
				}
			});
		return {
			running: services.some((s) => s.state === "running"),
			services,
			raw,
		};
	} catch {
		return { running: false, services: [], raw: "" };
	}
}

/** Check if a supported container runtime is reachable. */
export function isDockerAvailable(): boolean {
	const compose = resolveComposeCommand();
	const infoCommand =
		compose.command === "podman-compose" ? "podman" : compose.command;
	try {
		execSync(`${infoCommand} info`, { stdio: "ignore", timeout: 5_000 });
		return true;
	} catch {
		return false;
	}
}

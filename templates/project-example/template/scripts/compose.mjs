#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const FORCED_RUNTIME =
	process.env.CFXDEVKIT_RUNTIME?.trim().toLowerCase() ?? "";
const LOOKUP_CMD = process.platform === "win32" ? "where" : "which";

function commandExists(cmd) {
	try {
		execFileSync(LOOKUP_CMD, [cmd], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function commandSucceeds(cmd, args) {
	try {
		execFileSync(cmd, args, { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function resolveDockerComposeCommand() {
	if (
		commandExists("docker") &&
		commandSucceeds("docker", ["compose", "version"])
	) {
		return { runtime: "docker", cmd: "docker", args: ["compose"] };
	}
	if (commandExists("docker-compose")) {
		return { runtime: "docker", cmd: "docker-compose", args: [] };
	}
	return null;
}

function resolveForcedRuntime() {
	if (!FORCED_RUNTIME) return null;
	if (FORCED_RUNTIME !== "docker" && FORCED_RUNTIME !== "podman") {
		console.error(
			`Unsupported CFXDEVKIT_RUNTIME: ${FORCED_RUNTIME}. Expected "docker" or "podman".`,
		);
		process.exit(1);
	}
	if (FORCED_RUNTIME === "docker") {
		const dockerCommand = resolveDockerComposeCommand();
		if (!dockerCommand) {
			console.error(
				"Requested runtime docker is not available. Install Docker CLI with compose support or docker-compose.",
			);
			process.exit(1);
		}
		return FORCED_RUNTIME;
	}
	if (!commandExists("podman")) {
		console.error("Requested runtime not found in PATH: podman");
		process.exit(1);
	}
	return FORCED_RUNTIME;
}

function resolveCompose() {
	const forcedRuntime = resolveForcedRuntime();
	if (forcedRuntime === "podman") {
		if (commandExists("podman-compose")) {
			return {
				runtime: "podman",
				cmd: "podman-compose",
				args: ["--podman-run-args=--userns=keep-id"],
			};
		}
		return { runtime: "podman", cmd: "podman", args: ["compose"] };
	}
	if (forcedRuntime === "docker") {
		return resolveDockerComposeCommand();
	}

	if (commandExists("podman") && commandExists("podman-compose")) {
		return {
			runtime: "podman",
			cmd: "podman-compose",
			args: ["--podman-run-args=--userns=keep-id"],
		};
	}
	if (commandExists("podman")) {
		return { runtime: "podman", cmd: "podman", args: ["compose"] };
	}
	const dockerCommand = resolveDockerComposeCommand();
	if (dockerCommand) {
		return dockerCommand;
	}

	const socketHint = existsSync("/var/run/docker.sock")
		? " Docker socket is mounted, but the container image is missing a Docker-compatible CLI."
		: "";
	console.error(`Neither podman nor docker found in PATH.${socketHint}`);
	process.exit(1);
}

function shouldEnableDockerBuildkit(command, forwardedArgs) {
	if (command !== "docker") return false;
	return forwardedArgs.some((arg) => arg === "build" || arg === "up");
}

const { runtime, cmd, args } = resolveCompose();
const passthrough = process.argv.slice(2);
const env = { ...process.env };

if (runtime === "podman") {
	env.PODMAN_USERNS = env.PODMAN_USERNS ?? "keep-id";
}

if (shouldEnableDockerBuildkit(cmd, passthrough)) {
	env.DOCKER_BUILDKIT = env.DOCKER_BUILDKIT ?? "1";
	env.COMPOSE_DOCKER_CLI_BUILD = env.COMPOSE_DOCKER_CLI_BUILD ?? "1";
}

const result = spawnSync(cmd, [...args, ...passthrough], {
	stdio: "inherit",
	env,
});
if (result.error) {
	console.error(result.error.message);
	process.exit(1);
}

process.exit(result.status ?? 0);

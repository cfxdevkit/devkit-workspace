import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export function parseOperationFlags(argv = process.argv.slice(2)) {
	return {
		json: argv.includes("--json"),
	};
}

export async function runOperation(name, flags, executor) {
	const operationId = randomUUID();
	const startedAt = new Date().toISOString();
	const started = Date.now();
	const steps = [];

	function step(stepName, details = {}) {
		steps.push({
			name: stepName,
			at: new Date().toISOString(),
			...details,
		});
	}

	try {
		const result = await executor({ flags, step, operationId });
		const record = {
			schemaVersion: 1,
			operationId,
			operation: name,
			status: "success",
			startedAt,
			finishedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
			steps,
			result,
		};

		persistOperationRecord(record);
		renderOperationRecord(record, flags);
		return record;
	} catch (error) {
		const record = {
			schemaVersion: 1,
			operationId,
			operation: name,
			status: "error",
			startedAt,
			finishedAt: new Date().toISOString(),
			durationMs: Date.now() - started,
			steps,
			error: serializeError(error),
		};

		persistOperationRecord(record);
		renderOperationRecord(record, flags);
		throw error;
	}
}

function persistOperationRecord(record) {
	const operationsDir = resolve(process.cwd(), ".devkit", "operations");
	mkdirSync(operationsDir, { recursive: true });
	writeFileSync(
		resolve(operationsDir, `${record.operation}.latest.json`),
		`${JSON.stringify(record, null, 2)}\n`,
		"utf8",
	);
	appendFileSync(
		resolve(operationsDir, "ledger.ndjson"),
		`${JSON.stringify(record)}\n`,
		"utf8",
	);
}

function renderOperationRecord(record, flags) {
	if (flags.json) {
		console.log(JSON.stringify(record, null, 2));
		return;
	}

	const summary = `${record.operation}: ${record.status} (${record.durationMs}ms)`;
	console.log(summary);

	if (record.status === "success" && record.result?.message) {
		console.log(record.result.message);
	}

	if (record.status === "error" && record.error?.message) {
		console.error(record.error.message);
	}
}

function serializeError(error) {
	if (error instanceof Error) {
		return {
			name: error.name,
			message: error.message,
		};
	}

	return {
		name: "Error",
		message: String(error),
	};
}

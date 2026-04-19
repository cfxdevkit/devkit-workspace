/**
 * Typed error classes for the devkit backend.
 *
 * Each class maps to a specific HTTP status code. The global error middleware
 * inspects `err.statusCode` to generate the correct response, so route
 * handlers can simply `throw` without manually setting `res.status(...)`.
 */

export class AppError extends Error {
	readonly statusCode: number;
	/** Optional machine-readable code for clients to match on. */
	readonly code?: string;
	/** Optional extra data to include in the response body. */
	readonly details?: unknown;

	constructor(
		message: string,
		statusCode = 500,
		opts?: { code?: string; details?: unknown },
	) {
		super(message);
		this.name = "AppError";
		this.statusCode = statusCode;
		this.code = opts?.code;
		this.details = opts?.details;
	}
}

/** 400 — caller sent invalid data */
export class ValidationError extends AppError {
	constructor(message: string, details?: unknown) {
		super(message, 400, { code: "VALIDATION_ERROR", details });
		this.name = "ValidationError";
	}
}

/** 401 — missing or invalid credentials */
export class AuthError extends AppError {
	constructor(message = "Unauthorized") {
		super(message, 401, { code: "AUTH_ERROR" });
		this.name = "AuthError";
	}
}

/** 404 — resource not found */
export class NotFoundError extends AppError {
	constructor(message: string) {
		super(message, 404, { code: "NOT_FOUND" });
		this.name = "NotFoundError";
	}
}

/** 409 — operation conflicts with current state */
export class ConflictError extends AppError {
	constructor(message: string) {
		super(message, 409, { code: "CONFLICT" });
		this.name = "ConflictError";
	}
}

/** 503 — a required subsystem (node, compiler) is unavailable */
export class ServiceUnavailableError extends AppError {
	constructor(message: string) {
		super(message, 503, { code: "SERVICE_UNAVAILABLE" });
		this.name = "ServiceUnavailableError";
	}
}

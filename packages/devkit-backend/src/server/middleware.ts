import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "./errors.js";
import { log } from "./logger.js";

/**
 * Wrap an async route handler so rejected promises are forwarded to the
 * Express error middleware instead of crashing the process.
 *
 * Usage:
 *   router.post('/foo', asyncHandler(async (req, res) => { ... }));
 */
export function asyncHandler(
	fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
	return (req, res, next) => {
		fn(req, res, next).catch(next);
	};
}

/**
 * Global Express error middleware.
 *
 * - Reads `statusCode` from AppError subclasses.
 * - Logs the full stack to the log file for debugging.
 * - Returns a consistent JSON envelope to the client.
 */
export function errorMiddleware(
	err: Error,
	req: Request,
	res: Response,
	_next: NextFunction,
): void {
	const statusCode = err instanceof AppError ? err.statusCode : 500;
	const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
	const details = err instanceof AppError ? err.details : undefined;

	// Log at appropriate level
	if (statusCode >= 500) {
		log.error(`${req.method} ${req.path} → ${statusCode}`, err);
	} else {
		log.warn(`${req.method} ${req.path} → ${statusCode}: ${err.message}`);
	}

	const body: Record<string, unknown> = {
		error: err.message,
		code,
	};
	if (details !== undefined) {
		body.details = details;
	}

	res.status(statusCode).json(body);
}

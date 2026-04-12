/**
 * errors.ts — Structured error taxonomy and operation correlation for CFX DevKit.
 *
 * DevkitError: typed error class used across the MCP server, VS Code extension,
 * and backend boundaries. Callers can narrow on `error.code` to handle
 * specific failure modes without parsing string messages.
 *
 * generateOpId: produces a short unique ID for correlating log lines from the
 * same top-level operation across MCP → backend → extension boundaries.
 */

/**
 * Generates a short, unique operation identifier for log correlation.
 *
 * Format: `op_<6-hex-chars>_<ms-timestamp-mod-1M>` — compact enough to
 * prefix progress lines without dominating them.
 *
 * Example: `op_3fa2c1_847392`
 */
export function generateOpId(): string {
  const rand = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
  const ts = (Date.now() % 1_000_000).toString().padStart(6, '0');
  return `op_${rand}_${ts}`;
}

export enum DevkitErrorCode {
  // ── Backend communication ────────────────────────────────────────────────
  BACKEND_UNAVAILABLE = 'BACKEND_UNAVAILABLE',
  BACKEND_HTTP_ERROR = 'BACKEND_HTTP_ERROR',

  // ── Node / keystore state ────────────────────────────────────────────────
  NODE_NOT_RUNNING = 'NODE_NOT_RUNNING',
  KEYSTORE_LOCKED = 'KEYSTORE_LOCKED',
  KEYSTORE_NOT_FOUND = 'KEYSTORE_NOT_FOUND',
  KEYSTORE_INVALID = 'KEYSTORE_INVALID',

  // ── DEX: deploy / seed preconditions ───────────────────────────────────
  DEX_MANIFEST_NOT_FOUND = 'DEX_MANIFEST_NOT_FOUND',
  DEX_SEED_NOT_FOUND = 'DEX_SEED_NOT_FOUND',
  DEX_TRANSLATION_TABLE_MISSING = 'DEX_TRANSLATION_TABLE_MISSING',
  DEX_NO_SEEDED_PAIRS = 'DEX_NO_SEEDED_PAIRS',
  DEX_DEPLOY_FAILED = 'DEX_DEPLOY_FAILED',
  DEX_SEED_FAILED = 'DEX_SEED_FAILED',
  DEX_INSUFFICIENT_FUNDS = 'DEX_INSUFFICIENT_FUNDS',

  // ── Simulation ───────────────────────────────────────────────────────────
  SIMULATION_ALREADY_RUNNING = 'SIMULATION_ALREADY_RUNNING',
  SIMULATION_ENGINE_DESTROYED = 'SIMULATION_ENGINE_DESTROYED',

  // ── Contracts / compilation ─────────────────────────────────────────────
  ARTIFACT_NOT_FOUND = 'ARTIFACT_NOT_FOUND',
  COMPILATION_FAILED = 'COMPILATION_FAILED',

  // ── Generic ─────────────────────────────────────────────────────────────
  UNKNOWN = 'UNKNOWN',
}

export interface DevkitErrorOptions {
  cause?: unknown;
}

export class DevkitError extends Error {
  readonly code: DevkitErrorCode;
  readonly cause: unknown;

  constructor(code: DevkitErrorCode, message: string, options?: DevkitErrorOptions) {
    super(message);
    this.name = 'DevkitError';
    this.code = code;
    this.cause = options?.cause;
  }

  static is(err: unknown): err is DevkitError {
    return err instanceof DevkitError;
  }

  static hasCode(err: unknown, code: DevkitErrorCode): boolean {
    return DevkitError.is(err) && err.code === code;
  }
}

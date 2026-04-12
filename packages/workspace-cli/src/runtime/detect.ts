/**
 * runtime/detect.ts — runtime (docker/podman) detection and validation.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { fail } from '../util.js';
import type { Runtime } from '../types.js';

// ── Binary helpers ─────────────────────────────────────────────────────────

export function commandExists(cmd: string): boolean {
  try {
    execFileSync('which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function commandPath(cmd: string): string {
  try {
    return execFileSync('which', [cmd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// ── Runtime detection ──────────────────────────────────────────────────────

export function detectRuntime(preferred: Runtime | null): Runtime {
  if (preferred) return preferred;
  if (commandExists('podman')) return 'podman';
  if (commandExists('docker')) return 'docker';
  fail('Neither docker nor podman found in PATH.');
}

export function detectSocket(runtime: Runtime, override: string | null): string | null {
  if (override) return override;

  const candidates =
    runtime === 'podman'
      ? [
          `/run/user/${process.getuid?.() ?? 1000}/podman/podman.sock`,
          '/run/podman/podman.sock',
        ]
      : [
          '/var/run/docker.sock',
          `${process.env.HOME}/.docker/run/docker.sock`,
        ];

  return candidates.find(existsSync) ?? null;
}

export function validateRuntimeAccess(runtime: Runtime, runFn: (rt: Runtime, args: string[], inherit?: boolean) => number): void {
  if (runFn(runtime, ['info'], false) !== 0) {
    fail(`${runtime} is installed but not accessible. Run 'conflux-workspace doctor' for details.`);
  }
}

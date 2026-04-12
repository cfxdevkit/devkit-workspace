/**
 * util.ts — shared pure utilities: fail, table rendering, profile display helpers.
 */

import type { ProfileSummary } from './types.js';

// ── Process exit helper ────────────────────────────────────────────────────

export function fail(message: string): never {
  console.error(message);
  process.exit(1);
  throw new Error('unreachable');
}

// ── Table rendering ────────────────────────────────────────────────────────

export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const values = rows.map((row) => row[index] ?? '');
    return Math.max(header.length, ...values.map((value) => value.length));
  });

  const formatRow = (row: string[]) => row.map((value, index) => (value ?? '').padEnd(widths[index])).join('  ');
  const separator = widths.map((width) => '-'.repeat(width)).join('  ');

  return [formatRow(headers), separator, ...rows.map(formatRow)].join('\n');
}

// ── Profile display helpers ────────────────────────────────────────────────

export function aliasDisplay(aliasNames: string[]): string {
  return aliasNames.length > 0 ? aliasNames.map((aliasName) => `@${aliasName}`).join(', ') : '-';
}

export function describeProfileState(profile: ProfileSummary): string {
  const containerPresent = profile.containerStatus !== 'missing';

  if (containerPresent && profile.volumePresent) {
    return profile.containerStatus.toLowerCase().startsWith('up') ? 'running' : 'stopped';
  }

  if (containerPresent) {
    return 'container-only';
  }

  if (profile.volumePresent) {
    return 'persisted-volume';
  }

  return 'missing';
}

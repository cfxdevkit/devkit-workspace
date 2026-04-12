/**
 * command-parity.test.ts
 *
 * Static smoke test: every command ID declared in package.json#contributes.commands
 * must appear as a string literal somewhere in the TypeScript source tree.
 *
 * This guard prevents the manifest from silently drifting ahead of implementation
 * (contributed but never registered) without requiring the VS Code host or an
 * extension runner.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect all *.ts source files under `dir`. */
function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

// ── Fixture loading ───────────────────────────────────────────────────────────

const extensionRoot = resolve(__dirname, '../..');

const pkgPath = join(extensionRoot, 'package.json');
expect(existsSync(pkgPath), `package.json not found at ${pkgPath}`).toBe(true);

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
  contributes?: { commands?: { command: string }[] };
};

const manifestIds: string[] = (pkg.contributes?.commands ?? []).map((c) => c.command);

const srcDir = join(extensionRoot, 'src');
const sourceFiles = collectTsFiles(srcDir).filter(
  // Exclude this test file itself from the source scan
  (f) => !f.includes('__tests__'),
);

const allSource = sourceFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('extension command parity (manifest vs source)', () => {
  it('package.json contributes at least one command', () => {
    expect(manifestIds.length).toBeGreaterThan(0);
  });

  it('source tree is non-empty', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it.each(manifestIds)(
    '%s — appears as a string literal in source',
    (commandId) => {
      // The command ID must appear as a quoted string literal in at least one source file.
      // We check for both quote styles to be resilient to formatting.
      const inSource =
        allSource.includes(`'${commandId}'`) || allSource.includes(`"${commandId}"`);
      expect(
        inSource,
        `'${commandId}' is in package.json#contributes.commands but not found as a string literal in any src/**/*.ts file`,
      ).toBe(true);
    },
  );
});

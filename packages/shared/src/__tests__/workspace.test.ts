import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fileExists,
  getComposeFilePath,
  readJsonFile,
  workspacePath,
  workspaceRoot,
} from '../workspace';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import * as fs from 'node:fs';

import * as path from 'node:path';

describe('workspaceRoot', () => {
  it('returns process.cwd()', () => {
    expect(workspaceRoot()).toBe(process.cwd());
  });
});

describe('workspacePath', () => {
  it('joins segments onto cwd', () => {
    const expected = path.join(process.cwd(), 'packages', 'shared');
    expect(workspacePath('packages', 'shared')).toBe(expected);
  });

  it('handles single segment', () => {
    expect(workspacePath('foo')).toBe(path.join(process.cwd(), 'foo'));
  });
});

describe('fileExists', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('returns true for existing file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    expect(fileExists('/some/file.txt')).toBe(true);
  });

  it('returns false for missing file', () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    expect(fileExists('/missing/file.txt')).toBe(false);
  });
});

describe('readJsonFile', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('parses JSON file content', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ key: 'value' }));
    const result = readJsonFile<{ key: string }>('/fake/file.json');
    expect(result).toEqual({ key: 'value' });
  });

  it('throws on invalid JSON', () => {
    vi.mocked(fs.readFileSync).mockReturnValue('not-json');
    expect(() => readJsonFile('/fake/file.json')).toThrow();
  });
});

describe('getComposeFilePath', () => {
  it('defaults to docker-compose.yml in cwd', () => {
    expect(getComposeFilePath()).toBe(path.join(process.cwd(), 'docker-compose.yml'));
  });

  it('uses override when provided', () => {
    expect(getComposeFilePath('compose.prod.yml')).toBe(
      path.join(process.cwd(), 'compose.prod.yml')
    );
  });
});

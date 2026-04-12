import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getComposeStatus,
  isDockerAvailable,
  runCompose,
} from '../docker';

// Mock the entire child_process module so vi.fn() replaces built-in functions
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  execSync: vi.fn(),
}));

// Import AFTER vi.mock so the mocked version is used
import * as childProcess from 'node:child_process';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSyncResult(overrides: Partial<ReturnType<typeof childProcess.spawnSync>>) {
  return {
    pid: 1,
    output: [],
    stdout: '',
    stderr: '',
    status: 0,
    signal: null,
    error: undefined,
    ...overrides,
  } as ReturnType<typeof childProcess.spawnSync>;
}

// ── runCompose ────────────────────────────────────────────────────────────────

describe('runCompose', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('calls docker compose with subcommand', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: 'ok\n' }));
    const out = runCompose(['ps']);
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      'docker', expect.arrayContaining(['compose', 'ps']), expect.any(Object)
    );
    expect(out).toBe('ok\n');
  });

  it('includes -f flag when composeFile is set', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: '' }));
    runCompose(['up', '-d'], { composeFile: 'custom.yml' });
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      'docker', expect.arrayContaining(['-f', 'custom.yml']), expect.any(Object)
    );
  });

  it('includes -p flag when projectName is set', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: '' }));
    runCompose(['up', '-d'], { projectName: 'myproject' });
    expect(childProcess.spawnSync).toHaveBeenCalledWith(
      'docker', expect.arrayContaining(['-p', 'myproject']), expect.any(Object)
    );
  });

  it('throws when docker exits with non-zero status', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(
      makeSyncResult({ status: 1, stderr: 'no such service' })
    );
    expect(() => runCompose(['up', '-d', 'missing'])).toThrow('no such service');
  });

  it('throws when spawnSync returns an error', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(
      makeSyncResult({ error: new Error('ENOENT') })
    );
    expect(() => runCompose(['ps'])).toThrow('ENOENT');
  });
});

// ── getComposeStatus ──────────────────────────────────────────────────────────

describe('getComposeStatus', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('parses running services correctly', () => {
    const jsonLine = JSON.stringify({
      Name: 'myapp-backend-1', State: 'running',
      Publishers: [{ PublishedPort: 8000, TargetPort: 8000 }],
    });
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: `${jsonLine}\n` }));
    const status = getComposeStatus();
    expect(status.running).toBe(true);
    expect(status.services).toHaveLength(1);
    expect(status.services[0]).toMatchObject({ name: 'myapp-backend-1', state: 'running', ports: '8000->8000' });
  });

  it('parses exited services', () => {
    const jsonLine = JSON.stringify({ Name: 'db', State: 'exited', Publishers: [] });
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: `${jsonLine}\n` }));
    const status = getComposeStatus();
    expect(status.running).toBe(false);
    expect(status.services[0].state).toBe('exited');
  });

  it('handles multiple services — mixed state', () => {
    const lines = [
      JSON.stringify({ Name: 'web', State: 'running', Publishers: [] }),
      JSON.stringify({ Name: 'db', State: 'exited', Publishers: [] }),
    ].join('\n');
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: lines }));
    const status = getComposeStatus();
    expect(status.running).toBe(true);
    expect(status.services).toHaveLength(2);
  });

  it('returns empty status on docker error (never throws)', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ status: 1, stderr: 'daemon not running' }));
    const status = getComposeStatus();
    expect(status.running).toBe(false);
    expect(status.services).toHaveLength(0);
  });

  it('returns empty status on empty output', () => {
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: '' }));
    const status = getComposeStatus();
    expect(status.services).toHaveLength(0);
  });

  it('skips malformed JSON lines gracefully', () => {
    const lines = `not-json\n${JSON.stringify({ Name: 'web', State: 'running', Publishers: [] })}`;
    vi.mocked(childProcess.spawnSync).mockReturnValue(makeSyncResult({ stdout: lines }));
    const status = getComposeStatus();
    expect(status.services).toHaveLength(2);
    expect(status.services.some(s => s.state === 'running')).toBe(true);
  });
});

// ── isDockerAvailable ─────────────────────────────────────────────────────────

describe('isDockerAvailable', () => {
  afterEach(() => { vi.resetAllMocks(); });

  it('returns true when docker info succeeds', () => {
    vi.mocked(childProcess.execSync).mockReturnValue(Buffer.from(''));
    expect(isDockerAvailable()).toBe(true);
  });

  it('returns false when docker info throws', () => {
    vi.mocked(childProcess.execSync).mockImplementation(() => {
      throw new Error('Cannot connect to Docker daemon');
    });
    expect(isDockerAvailable()).toBe(false);
  });
});

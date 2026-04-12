import { execSync, spawnSync } from 'node:child_process';

export interface ComposeOptions {
  composeFile?: string;
  projectName?: string;
  cwd?: string;
}

export interface ComposeStatus {
  running: boolean;
  services: ServiceStatus[];
  raw: string;
}

export interface ServiceStatus {
  name: string;
  state: 'running' | 'exited' | 'paused' | 'unknown';
  ports: string;
}

function buildComposeArgs(opts: ComposeOptions): string[] {
  const args: string[] = [];
  if (opts.composeFile) {
    args.push('-f', opts.composeFile);
  }
  if (opts.projectName) {
    args.push('-p', opts.projectName);
  }
  return args;
}

/** Run docker compose and return stdout. Throws on non-zero exit. */
export function runCompose(subcommand: string[], opts: ComposeOptions = {}): string {
  const baseArgs = buildComposeArgs(opts);
  const allArgs = ['compose', ...baseArgs, ...subcommand];
  const result = spawnSync('docker', allArgs, {
    cwd: opts.cwd ?? process.cwd(),
    encoding: 'utf-8',
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `docker compose exited with ${result.status}`);
  }
  return result.stdout ?? '';
}

/** Get status of all compose services. Does not throw — returns empty on error. */
export function getComposeStatus(opts: ComposeOptions = {}): ComposeStatus {
  try {
    const raw = runCompose(['ps', '--format', 'json'], opts);
    // docker compose ps --format json outputs one JSON object per line
    const services: ServiceStatus[] = raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          const obj = JSON.parse(line) as { Name?: string; State?: string; Publishers?: { PublishedPort: number; TargetPort: number }[] };
          const ports = (obj.Publishers ?? [])
            .filter((p) => p.PublishedPort)
            .map((p) => `${p.PublishedPort}->${p.TargetPort}`)
            .join(', ');
          const state = (['running', 'exited', 'paused'].includes(obj.State ?? '') ? obj.State : 'unknown') as ServiceStatus['state'];
          return { name: obj.Name ?? 'unknown', state, ports };
        } catch {
          return { name: 'unknown', state: 'unknown' as const, ports: '' };
        }
      });
    return {
      running: services.some((s) => s.state === 'running'),
      services,
      raw,
    };
  } catch {
    return { running: false, services: [], raw: '' };
  }
}

/** Check if Docker daemon is reachable. */
export function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}



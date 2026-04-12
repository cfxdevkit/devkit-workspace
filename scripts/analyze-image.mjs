#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));

const image = positional[0] ?? `ghcr.io/cfxdevkit/devkit-workspace-web:${rootPackage.version}`;
const platform = readFlagValue(args, '--platform') ?? 'linux/amd64';
const shouldPull = flags.has('--pull');
const showHistory = flags.has('--history');

const [platformOs, platformArch] = platform.split('/');
if (!platformOs || !platformArch) {
  console.error(`Invalid platform: ${platform}. Expected os/arch, for example linux/amd64.`);
  process.exit(1);
}

const localPresentBeforePull = dockerStatus(['image', 'inspect', image]) === 0;
const resolved = resolveManifest(image, platformOs, platformArch);
const manifest = resolved?.manifest ?? null;
const compressedSize = Array.isArray(manifest?.layers)
  ? manifest.layers.reduce((sum, layer) => sum + (layer.size ?? 0), 0)
  : null;

console.log(`Image: ${image}`);
if (resolved) {
  console.log(`Platform: ${resolved.platform}`);
  console.log(`Resolved reference: ${resolved.reference}`);
  console.log(`Compressed layer size: ${formatBytes(compressedSize)} (${compressedSize} bytes)`);
} else {
  console.log(`Platform: ${platform}`);
  console.log('Resolved reference: unavailable (local image analysis)');
  console.log('Compressed layer size: unavailable (no registry manifest inspected)');
}

if (Array.isArray(manifest?.layers)) {
  console.log(`Layer count: ${manifest.layers.length}`);
  console.log('Largest compressed layers:');
  for (const layer of [...manifest.layers].sort((left, right) => (right.size ?? 0) - (left.size ?? 0)).slice(0, 8)) {
    console.log(`  ${formatBytes(layer.size ?? 0)}  ${layer.digest}`);
  }
}

if (shouldPull) {
  runStep('Pull image locally', ['docker', 'pull', '--platform', resolved.platform, image]);
}

const localPresent = dockerStatus(['image', 'inspect', image]) === 0;
if (localPresent) {
  const [localInfo] = dockerJson(['image', 'inspect', image]);
  console.log(`Local image size: ${formatBytes(localInfo.Size ?? 0)} (${localInfo.Size ?? 0} bytes)`);
  console.log(`Local image ID: ${localInfo.Id}`);

  if (showHistory) {
    console.log('History (newest first):');
    const history = execFileSync('docker', ['history', image, '--human', '--no-trunc', '--format', '{{json .}}'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    for (const entry of history.slice(0, 12)) {
      console.log(`  ${entry.Size.padEnd(10)} ${entry.CreatedBy}`);
    }
  }
} else {
  console.log('Local image size: unavailable (image not present locally). Use --pull to fetch it first.');
}

function resolveManifest(imageRef, os, arch) {
  let verbose;
  try {
    verbose = dockerJson(['manifest', 'inspect', '--verbose', imageRef]);
  } catch {
    return null;
  }

  if (!Array.isArray(verbose)) {
    if (Array.isArray(verbose.layers)) {
      return {
        reference: imageRef,
        platform: `${os}/${arch}`,
        manifest: verbose,
      };
    }
    console.error('Unsupported manifest response: expected verbose manifest array or single manifest object.');
    process.exit(1);
  }

  const selected =
    verbose.find((entry) => entry.Descriptor?.platform?.os === os && entry.Descriptor?.platform?.architecture === arch) ??
    verbose.find((entry) => {
      const platform = entry.Descriptor?.platform;
      return platform?.os && platform?.architecture && platform.os !== 'unknown' && platform.architecture !== 'unknown';
    });

  const manifest = selected?.OCIManifest;
  const ref = selected?.Ref;
  const selectedPlatform = selected?.Descriptor?.platform;

  if (!manifest || !ref || !selectedPlatform?.os || !selectedPlatform?.architecture) {
    console.error(`No concrete manifest found for platform ${os}/${arch}.`);
    process.exit(1);
  }

  return {
    reference: ref,
    platform: `${selectedPlatform.os}/${selectedPlatform.architecture}`,
    manifest,
  };
}

function dockerJson(commandArgs) {
  return JSON.parse(execFileSync('docker', commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

function dockerStatus(commandArgs) {
  const result = spawnSync('docker', commandArgs, {
    cwd: repoRoot,
    stdio: 'ignore',
  });
  return result.status ?? 1;
}

function runStep(label, command) {
  console.log(`==> ${label}`);
  const result = spawnSync(command[0], command.slice(1), {
    cwd: repoRoot,
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

function readFlagValue(argv, name) {
  const index = argv.indexOf(name);
  if (index === -1 || index === argv.length - 1) {
    return null;
  }
  return argv[index + 1];
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
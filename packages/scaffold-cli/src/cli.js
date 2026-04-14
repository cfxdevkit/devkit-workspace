#!/usr/bin/env node

import { resolve } from 'node:path';

import {
  createProject,
  getTargetSummaries,
  getTemplateSummaries,
  resolveTemplateTarget,
} from '../../template-core/src/index.js';

function printUsage() {
  console.log('Usage: new-devkit <command> [options]');
  console.log('');
  console.log('Commands:');
  console.log('  create <destination> --template <name> [--target <name>] [--json]');
  console.log('  list-templates [--json]');
  console.log('  list-targets [--json]');
  console.log('  help');
  console.log('');
  console.log('Examples:');
  console.log('  new-devkit create ./my-app --template minimal-dapp');
  console.log('  new-devkit create ./my-app --template project-example --target code-server');
  console.log('  new-devkit list-templates');
}

function parseArgs(argv) {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    if (token === '--json') {
      options.json = true;
      continue;
    }

    const nextValue = argv[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      throw new Error(`Missing value for option: ${token}`);
    }

    options[token.slice(2)] = nextValue;
    index += 1;
  }

  return { positionals, options };
}

function printTemplateList(jsonOutput) {
  const templates = getTemplateSummaries();

  if (jsonOutput) {
    console.log(JSON.stringify(templates, null, 2));
    return;
  }

  for (const template of templates) {
    const tags = template.tags.length > 0 ? ` [${template.tags.join(', ')}]` : '';
    const defaultTarget = template.defaultTarget ? ` default=${template.defaultTarget}` : '';
    console.log(`${template.name}${tags}`);
    console.log(`  ${template.description}`);
    console.log(`  targets=${template.supportedTargets.join(', ')}${defaultTarget}`);
  }
}

function printTargetList(jsonOutput) {
  const targets = getTargetSummaries();

  if (jsonOutput) {
    console.log(JSON.stringify(targets, null, 2));
    return;
  }

  for (const target of targets) {
    const status = target.recommended ? 'recommended' : 'optional';
    const featureFlags = Object.entries(target.features)
      .map(([key, enabled]) => `${key}=${enabled}`)
      .join(', ');
    console.log(`${target.name} (${status})`);
    console.log(`  ${target.description}`);
    console.log(`  runtime=${target.runtime} features=${featureFlags}`);
  }
}

function printCreateResult(result, jsonOutput) {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Created ${result.template} at ${result.destinationPath}`);
  console.log(`Target: ${result.target}`);
  console.log(`Package: ${result.packageName}`);
}

function runCreate(positionals, options) {
  const destinationArg = positionals[1];
  const templateName = options.template;

  if (!destinationArg || !templateName) {
    throw new Error('create requires a destination path and --template <name>.');
  }

  const { template, target } = resolveTemplateTarget(templateName, options.target ?? null);
  const result = createProject({
    destinationPath: resolve(process.cwd(), destinationArg),
    templateName: template.name,
    targetName: target.name,
  });

  printCreateResult(result, Boolean(options.json));
}

function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === 'help' || command === '--help') {
    printUsage();
    return;
  }

  let parsed;
  try {
    parsed = parseArgs(argv.slice(1));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.log('');
    printUsage();
    process.exit(1);
  }

  try {
    if (command === 'list-templates') {
      printTemplateList(Boolean(parsed.options.json));
      return;
    }

    if (command === 'list-targets') {
      printTargetList(Boolean(parsed.options.json));
      return;
    }

    if (command === 'create') {
      runCreate([command, ...parsed.positionals], parsed.options);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

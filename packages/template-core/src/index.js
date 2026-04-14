import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..');
const templatesRoot = resolve(repoRoot, 'templates');
const targetsRoot = resolve(repoRoot, 'targets');
const uiSharedRoot = resolve(repoRoot, 'packages', 'ui-shared');
const uiSharedCopyExcludes = new Set(['node_modules', 'dist', '.turbo', '.next']);
const textFileExtensions = new Set(['.json', '.md', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.html', '.css', '.yml', '.yaml', '.env', '.txt']);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sortByName(items) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name));
}

function listManifestDirectories(rootPath, manifestName) {
  return readdirSync(rootPath)
    .map((name) => ({ name, fullPath: resolve(rootPath, name) }))
    .filter((entry) => statSync(entry.fullPath).isDirectory())
    .filter((entry) => existsSync(resolve(entry.fullPath, manifestName)));
}

export function getTemplates() {
  return sortByName(listManifestDirectories(templatesRoot, 'template.json').map((entry) => {
    const manifestPath = resolve(entry.fullPath, 'template.json');
    const manifest = readJson(manifestPath);
    return {
      ...manifest,
      rootPath: entry.fullPath,
      manifestPath,
      templatePath: resolve(entry.fullPath, manifest.templateDir),
    };
  }));
}

export function getTargets() {
  return sortByName(listManifestDirectories(targetsRoot, 'target.json').map((entry) => {
    const manifestPath = resolve(entry.fullPath, 'target.json');
    const manifest = readJson(manifestPath);
    return {
      ...manifest,
      rootPath: entry.fullPath,
      manifestPath,
      filesPath: resolve(entry.fullPath, manifest.filesDir),
    };
  }));
}

export function getTemplateSummaries() {
  return getTemplates().map((template) => ({
    name: template.name,
    description: template.description,
    defaultTarget: template.defaultTarget ?? null,
    supportedTargets: template.supportedTargets ?? [],
    tags: template.tags ?? [],
  }));
}

export function getTargetSummaries() {
  return getTargets().map((target) => ({
    name: target.name,
    description: target.description,
    runtime: target.runtime ?? null,
    recommended: Boolean(target.recommended),
    features: target.features,
  }));
}

export function getTemplateNames() {
  return getTemplates().map((template) => template.name);
}

export function getTargetNames() {
  return getTargets().map((target) => target.name);
}

export function findTemplate(name) {
  return getTemplates().find((template) => template.name === name) ?? null;
}

export function findTarget(name) {
  return getTargets().find((target) => target.name === name) ?? null;
}

export function resolveTemplateTarget(templateName, requestedTargetName) {
  const template = findTemplate(templateName);
  if (!template) {
    throw new Error(`Unknown template: ${templateName}`);
  }

  const targetName = requestedTargetName ?? template.defaultTarget;
  if (!targetName) {
    throw new Error(`Template ${template.name} does not declare a default target.`);
  }

  const target = findTarget(targetName);
  if (!target) {
    throw new Error(`Unknown target: ${targetName}`);
  }

  if (template.supportedTargets?.length && !template.supportedTargets.includes(target.name)) {
    throw new Error(`Template ${template.name} does not support target ${target.name}`);
  }

  return { template, target };
}

function ensureEmptyDestination(destinationPath) {
  if (!existsSync(destinationPath)) {
    mkdirSync(destinationPath, { recursive: true });
    return;
  }

  const entries = readdirSync(destinationPath);
  if (entries.length > 0) {
    throw new Error(`Destination directory is not empty: ${destinationPath}`);
  }
}

function copyDirectoryContents(sourcePath, destinationPath, excludes = new Set()) {
  mkdirSync(destinationPath, { recursive: true });
  for (const entryName of readdirSync(sourcePath)) {
    if (excludes.has(entryName)) {
      continue;
    }

    cpSync(join(sourcePath, entryName), join(destinationPath, entryName), { recursive: true });
  }
}

function normalizePackageName(value) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9-_]+/g, '-');
  return normalized.replace(/^-+|-+$/g, '') || 'new-devkit-app';
}

function isTextFile(filePath) {
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith('.env') || lowerPath.endsWith('.gitignore')) {
    return true;
  }

  for (const extension of textFileExtensions) {
    if (lowerPath.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function renderText(template, context) {
  return template
    .replaceAll('{{PROJECT_NAME}}', context.projectName)
    .replaceAll('{{PACKAGE_NAME}}', context.packageName)
    .replaceAll('{{TARGET_NAME}}', context.targetName)
    .replaceAll('{{TARGET_DESCRIPTION}}', context.targetDescription)
    .replaceAll('{{BASE_URL_ENABLED}}', String(context.targetFeatures.baseUrl))
    .replaceAll('{{PROXY_ENABLED}}', String(context.targetFeatures.proxy))
    .replaceAll('{{CODE_SERVER_ENABLED}}', String(context.targetFeatures.codeServer));
}

function copyRenderedTree(sourcePath, destinationPath, context, excludes = new Set()) {
  mkdirSync(destinationPath, { recursive: true });

  for (const entryName of readdirSync(sourcePath)) {
    if (excludes.has(entryName)) {
      continue;
    }

    const sourceEntryPath = resolve(sourcePath, entryName);
    const destinationEntryPath = resolve(destinationPath, entryName);
    const entryStats = statSync(sourceEntryPath);

    if (entryStats.isDirectory()) {
      copyRenderedTree(sourceEntryPath, destinationEntryPath, context, excludes);
      continue;
    }

    if (isTextFile(sourceEntryPath)) {
      const rawText = readFileSync(sourceEntryPath, 'utf8');
      writeFileSync(destinationEntryPath, renderText(rawText, context));
      continue;
    }

    cpSync(sourceEntryPath, destinationEntryPath);
  }
}

function materializeUiShared(destinationPath) {
  if (!existsSync(resolve(uiSharedRoot, 'package.json'))) {
    throw new Error(`Canonical ui-shared package not found: ${uiSharedRoot}`);
  }

  copyDirectoryContents(uiSharedRoot, resolve(destinationPath, 'ui-shared'), uiSharedCopyExcludes);

  const sourcePackage = readJson(resolve(uiSharedRoot, 'package.json'));
  const destinationPackage = readJson(resolve(destinationPath, 'ui-shared', 'package.json'));
  if (sourcePackage.version !== destinationPackage.version) {
    throw new Error('ui-shared version mismatch after materialization');
  }

  return {
    name: sourcePackage.name,
    version: sourcePackage.version,
  };
}

function writeTargetModule(destinationPath, template, payload) {
  const relativeTargetModulePath = template.generated?.targetModulePath ?? 'src/generated/devkit-target.js';
  const absoluteTargetModulePath = resolve(destinationPath, relativeTargetModulePath);
  mkdirSync(dirname(absoluteTargetModulePath), { recursive: true });
  writeFileSync(
    absoluteTargetModulePath,
    `export const devkitTarget = ${JSON.stringify(payload, null, 2)};\n`,
  );
}

function writeGenerationManifest(destinationPath, payload) {
  const metadataDir = resolve(destinationPath, '.new-devkit');
  mkdirSync(metadataDir, { recursive: true });
  writeFileSync(resolve(metadataDir, 'manifest.json'), JSON.stringify(payload, null, 2));
}

export function createProject({ destinationPath, templateName, targetName }) {
  const { template, target } = resolveTemplateTarget(templateName, targetName);

  const projectName = basename(destinationPath);
  const packageName = normalizePackageName(projectName);
  const renderContext = {
    projectName,
    packageName,
    targetName: target.name,
    targetDescription: target.description,
    targetFeatures: target.features,
  };

  ensureEmptyDestination(destinationPath);
  copyRenderedTree(template.templatePath, destinationPath, renderContext);
  copyRenderedTree(target.filesPath, destinationPath, renderContext);

  let uiShared = null;
  if (template.materialize?.uiShared) {
    uiShared = materializeUiShared(destinationPath);
  }

  writeTargetModule(destinationPath, template, {
    name: target.name,
    description: target.description,
    features: target.features,
  });

  writeGenerationManifest(destinationPath, {
    projectName,
    packageName,
    template: template.name,
    target: target.name,
    targetFeatures: target.features,
    materializedPackages: uiShared ? [uiShared] : [],
  });

  return {
    destinationPath,
    packageName,
    template: template.name,
    target: target.name,
  };
}

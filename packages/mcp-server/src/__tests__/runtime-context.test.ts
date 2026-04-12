import { afterEach, describe, expect, it } from 'vitest';
import {
  getWorkspaceContext,
  isWorkspaceContainerContext,
  resolveDevkitPort,
} from '../runtime-context.js';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('runtime context', () => {
  it('prefers explicit env contract for workspace execution', () => {
    process.env.CFXDEVKIT_AGENT_WORKSPACE = '/opt/devkit/project-example';
    process.env.CFXDEVKIT_PROJECT_ROOT = '/opt/devkit/project-example';
    process.env.CFXDEVKIT_BACKEND_URL = 'http://127.0.0.1:8844';
    process.env.CFXDEVKIT_COMPOSE_FILE = 'docker-compose.yml';
    process.env.CFXDEVKIT_RUNTIME_MODE = 'workspace-container';

    const context = getWorkspaceContext();

    expect(context.workspaceRoot).toBe('/opt/devkit/project-example');
    expect(context.projectRoot).toBe('/opt/devkit/project-example');
    expect(context.backendBaseUrl).toBe('http://127.0.0.1:8844');
    expect(context.composeFile).toBe('docker-compose.yml');
    expect(context.runtimeMode).toBe('workspace-container');
    expect(context.source).toBe('env');
    expect(isWorkspaceContainerContext(context)).toBe(true);
    expect(resolveDevkitPort(context)).toBe(8844);
  });

  it('lets an explicit tool port override backend url resolution', () => {
    process.env.CFXDEVKIT_BACKEND_URL = 'http://127.0.0.1:7748';

    const context = getWorkspaceContext();

    expect(resolveDevkitPort(context, 9999)).toBe(9999);
  });
});
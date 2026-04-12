import { describe, expect, it } from 'vitest';
import { dexToolDefinitions } from '../features/dex/dex-tool-definitions.js';

describe('dex tool schema snapshots', () => {
  it('keeps stable tool names and input schemas', () => {
    const normalized = dexToolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));

    expect(normalized).toMatchSnapshot();
  });
});

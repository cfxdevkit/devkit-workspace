#!/usr/bin/env node
/**
 * CFX DevKit MCP Server — CLI entrypoint
 *
 * Installed globally as `devkit-mcp` via:
 *   npm install -g @cfxdevkit/mcp
 *
 * Configure in opencode.json:
 *   "mcp": {
 *     "devkit": {
 *       "type": "local",
 *       "command": ["devkit-mcp"]
 *     }
 *   }
 *
 * The server factory is also importable as a library:
 *   import { createDevkitMcpServer } from '@cfxdevkit/mcp';
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDevkitMcpServer } from './server.js';

async function main() {
  const server = createDevkitMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('CFX DevKit MCP server started\n');
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});

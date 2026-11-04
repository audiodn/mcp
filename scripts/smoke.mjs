#!/usr/bin/env node
// End-to-end smoke test: build the server, spawn the real binary over stdio,
// and exercise a read-only knowledge tool with no network and no real API key.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'dist', 'index.js');

function assert(cond, msg) {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
}

console.log('Building...');
execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [ENTRY],
  // Knowledge-only smoke: no API key, so live API tools (including deletes) stay off.
  // Deletes are exposed whenever a key is set; they are not a separate opt-in.
  env: { ...process.env, ADN_API_KEY: '' },
});
const client = new Client({ name: 'smoke', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name);
console.log(`Listed ${names.length} tools.`);
assert(names.includes('adn_about'), 'adn_about missing');
assert(names.includes('adn_list_operations'), 'adn_list_operations missing');
assert(names.includes('adn_list_output_types'), 'adn_list_output_types missing');
assert(!names.includes('adn_delete_collection'), 'delete tool should be hidden without an API key');

const { resources } = await client.listResources();
assert(
  resources.some((r) => r.uri === 'audiodn://openapi.json'),
  'openapi resource missing',
);

const about = JSON.parse((await client.callTool({ name: 'adn_about', arguments: {} })).content[0].text);
assert(about.openapiVersion === '1.0.0', `unexpected openapi version: ${about.openapiVersion}`);

const ops = JSON.parse(
  (await client.callTool({ name: 'adn_list_operations', arguments: {} })).content[0].text,
);
assert(ops.operations.length === 34, `expected 34 operations, got ${ops.operations.length}`);

await client.close();
console.log('SMOKE OK');

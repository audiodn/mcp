import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const DIST_ENTRY = join(ROOT, 'dist', 'index.js');
const built = existsSync(DIST_ENTRY);

let client: Client | null = null;
afterAll(async () => {
  if (client) await client.close();
});

// Spawns the real built binary over stdio. Skipped when dist is not built
// (e.g. prepublishOnly runs tests before the build step); `npm run smoke`
// always builds first.
describe.skipIf(!built)('stdio smoke (built binary)', () => {
  it('starts, lists tools + resources, and answers an offline knowledge tool', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [DIST_ENTRY],
      env: { ...process.env, ADN_API_KEY: 'adn_smoke_test' },
    });
    client = new Client({ name: 'smoke', version: '1.0.0' });
    await client.connect(transport);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain('adn_about');
    expect(names).toContain('adn_list_operations');
    expect(names).not.toContain('adn_delete_collection');

    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain('audiodn://openapi.json');

    const res: any = await client.callTool({ name: 'adn_about', arguments: {} });
    const about = JSON.parse(res.content[0].text);
    expect(about.openapiVersion).toBe('1.0.0');
    expect(about.docsSource).toBe('bundled snapshot');
  }, 20_000);
});

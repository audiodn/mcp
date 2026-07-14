import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES_DIR, SNAPSHOTS_DIR } from '../paths.js';
import { getVersion } from '../version.js';
import { DocStore, type DocStoreData } from './store.js';

/**
 * Build a DocStore by reading the bundled snapshots + guides from disk.
 * Node-only (uses node:fs); the Cloudflare Worker builds its DocStore from
 * statically imported modules instead (see worker/assets.ts).
 */
export function loadDocStore(): DocStore {
  const guides: Record<string, string> = {};
  if (existsSync(GUIDES_DIR)) {
    for (const file of readdirSync(GUIDES_DIR)) {
      if (!file.endsWith('.md')) continue;
      guides[file.replace(/\.md$/, '')] = readFileSync(join(GUIDES_DIR, file), 'utf8');
    }
  }

  const data: DocStoreData = {
    openapi: JSON.parse(readFileSync(join(SNAPSHOTS_DIR, 'openapi.json'), 'utf8')),
    llmsFull: readFileSync(join(SNAPSHOTS_DIR, 'llms-full.txt'), 'utf8'),
    sources: JSON.parse(readFileSync(join(SNAPSHOTS_DIR, 'sources.json'), 'utf8')),
    guides,
    serverVersion: getVersion(),
  };
  return DocStore.fromData(data);
}

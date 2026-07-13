#!/usr/bin/env node
// Refresh the bundled canonical documentation snapshots from the PUBLIC AudioDN
// site. One-way: the MCP server reads the public website; runtime never depends
// on the monorepo. Run manually (`npm run sync`) or in a scheduled workflow.
//
// Updates:
//   assets/snapshots/openapi.json
//   assets/snapshots/llms-full.txt
//   assets/snapshots/sources.json   (urls, fetchedAt, sha256, openapiVersion)
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = join(ROOT, 'assets', 'snapshots');

const SITE = process.env.AUDIODN_SITE || 'https://audiodeliverynetwork.com';
const TARGETS = [
  { name: 'openapi.json', url: `${SITE}/openapi.json` },
  { name: 'llms-full.txt', url: `${SITE}/llms-full.txt` },
];

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

async function fetchText(url) {
  const res = await fetch(url, { headers: { accept: '*/*' } });
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  return res.text();
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const sources = [];
  let openapiVersion = 'unknown';

  for (const t of TARGETS) {
    process.stdout.write(`Fetching ${t.url} ... `);
    const body = await fetchText(t.url);
    writeFileSync(join(SNAP, t.name), body);
    sources.push({ name: t.name, url: t.url, fetchedAt: today, sha256: sha256(body) });
    console.log(`ok (${body.length} bytes)`);
    if (t.name === 'openapi.json') {
      openapiVersion = JSON.parse(body).info?.version || 'unknown';
    }
  }

  const manifest = {
    openapiVersion,
    generatedBy: 'scripts/sync-canonical.mjs',
    sources,
  };
  writeFileSync(join(SNAP, 'sources.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('Wrote sources.json. Sync complete.');
}

main().catch((err) => {
  console.error(`sync-canonical failed: ${err.message}`);
  process.exit(1);
});

#!/usr/bin/env node
// Guardrail for prepublishOnly: verify the bundled snapshots exist, are valid,
// and that sources.json recorded sha256 hashes still match the files on disk.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SNAP = join(ROOT, 'assets', 'snapshots');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function fail(msg) {
  console.error(`check-snapshots failed: ${msg}`);
  process.exit(1);
}

const sources = JSON.parse(readFileSync(join(SNAP, 'sources.json'), 'utf8'));

const openapi = JSON.parse(readFileSync(join(SNAP, 'openapi.json'), 'utf8'));
if (!openapi?.paths || Object.keys(openapi.paths).length === 0) {
  fail('openapi.json has no paths');
}
if (openapi.info?.version !== sources.openapiVersion) {
  fail(
    `sources.json openapiVersion (${sources.openapiVersion}) != openapi.json info.version (${openapi.info?.version})`,
  );
}

for (const src of sources.sources ?? []) {
  const bytes = readFileSync(join(SNAP, src.name));
  const actual = sha256(bytes);
  if (src.sha256 && src.sha256 !== actual) {
    fail(
      `sha256 mismatch for ${src.name}: sources.json=${src.sha256} disk=${actual}. Run "npm run sync" to refresh.`,
    );
  }
}

console.log(
  `Snapshots OK (openapi v${openapi.info?.version}, ${Object.keys(openapi.paths).length} paths).`,
);

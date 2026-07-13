import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This file compiles to `dist/paths.js`. The package root is one level up from
// the compiled output, so bundled `assets/` and `package.json` resolve the same
// whether the server runs from source (via a loader) or from `dist/`.
const HERE = dirname(fileURLToPath(import.meta.url));

export const PACKAGE_ROOT = join(HERE, '..');
export const ASSETS_DIR = join(PACKAGE_ROOT, 'assets');
export const SNAPSHOTS_DIR = join(ASSETS_DIR, 'snapshots');
export const GUIDES_DIR = join(ASSETS_DIR, 'guides');
export const PACKAGE_JSON = join(PACKAGE_ROOT, 'package.json');

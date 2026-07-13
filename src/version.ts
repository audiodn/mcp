import { readFileSync } from 'node:fs';
import { PACKAGE_JSON } from './paths.js';

let cached: string | null = null;

/** Server version, read from package.json so it never drifts from the release. */
export function getVersion(): string {
  if (cached) return cached;
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      version?: string;
    };
    cached = pkg.version ?? '0.0.0';
  } catch {
    cached = '0.0.0';
  }
  return cached;
}

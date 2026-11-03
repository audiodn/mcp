/**
 * Shared helpers for manual MCP scripts (not part of vitest).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MANUAL_DIR = __dirname;
export const ENV_PATH = join(MANUAL_DIR, '.env');

export function loadEnvFile(path = ENV_PATH) {
  const out = { ...process.env };
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function writeEnvFile(vars, path = ENV_PATH) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const map = new Map();
  for (const line of existing.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  for (const [k, v] of Object.entries(vars)) {
    map.set(k, v);
  }
  const body = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  writeFileSync(path, body, 'utf8');
}

export function base64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function randomToken(bytes = 32) {
  return base64Url(randomBytes(bytes));
}

export function pkcePair() {
  const verifier = randomToken(32);
  const challenge = base64Url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/**
 * Start a loopback redirect receiver. Returns { redirectUri, waitForCallback }.
 */
export function startLoopbackRedirect() {
  let resolveCb;
  const callbackPromise = new Promise((resolve) => {
    resolveCb = resolve;
  });

  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><html><body><h1>AudioDN MCP auth complete</h1><p>You can close this tab and return to the terminal.</p></body></html>',
    );
    server.close();
    resolveCb(url);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      resolve({
        redirectUri,
        waitForCallback: () => callbackPromise,
        close: () =>
          new Promise((r) => {
            try {
              server.close(() => r());
            } catch {
              r();
            }
          }),
      });
    });
  });
}

export function mcpBase(env) {
  return (env.MCP_URL || 'http://127.0.0.1:8788/mcp').replace(/\/$/, '');
}

export function issuerFromMcpUrl(mcpUrl) {
  const u = new URL(mcpUrl);
  return u.origin;
}

export function shortJson(value, max = 400) {
  const s = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (s.length <= max) return s;
  return `${s.slice(0, max)}…`;
}

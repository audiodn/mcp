#!/usr/bin/env node
/**
 * Headless local OAuth for QA when MCP_DEV_MODE=1.
 * Registers a client, follows /authorize to /oauth/dev-consent, POSTs Allow,
 * exchanges the code, writes manual/.env.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { ENV_PATH, writeEnvFile } from './lib.mjs';

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function randomToken(n = 32) {
  return b64url(randomBytes(n));
}
function pkcePair() {
  const verifier = randomToken(32);
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function startLoopback() {
  const server = createServer();
  const redirectUri = await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve(`http://127.0.0.1:${port}/callback`);
    });
  });
  const waitForCallback = () =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('callback timeout')), 30000);
      server.on('request', (req, res) => {
        clearTimeout(timer);
        const url = new URL(req.url, redirectUri);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('AudioDN QA auth OK — you can close this.');
        server.close();
        resolve(url);
      });
    });
  return { redirectUri, waitForCallback };
}

async function main() {
  const issuer = 'http://127.0.0.1:8788';
  const resource = 'http://127.0.0.1:8788/mcp';
  const { redirectUri, waitForCallback } = await startLoopback();

  const regRes = await fetch(`${issuer}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'AudioDN MCP QA auth',
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  const regBody = await regRes.json();
  if (!regRes.ok) {
    console.error('register failed', regBody);
    process.exit(1);
  }
  const clientId = regBody.client_id;
  const { verifier, challenge } = pkcePair();
  const state = randomToken(16);

  const authorize = new URL(`${issuer}/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('resource', resource);
  authorize.searchParams.set('scope', 'account');

  const authRes = await fetch(authorize, { redirect: 'manual' });
  const loc = authRes.headers.get('location');
  if (!loc) {
    console.error('authorize missing Location', authRes.status, await authRes.text());
    process.exit(1);
  }
  const consentUrl = new URL(loc, issuer);
  const txn = consentUrl.searchParams.get('txn');
  if (!txn) {
    console.error('no txn in consent redirect', consentUrl.toString());
    process.exit(1);
  }

  const callbackPromise = waitForCallback();
  const form = new URLSearchParams({ txn, decision: 'allow' });
  const consentRes = await fetch(`${issuer}/oauth/dev-consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
    redirect: 'manual',
  });
  const codeLoc = consentRes.headers.get('location');
  if (!codeLoc) {
    console.error('consent missing redirect', consentRes.status, await consentRes.text());
    process.exit(1);
  }
  // Hit the loopback redirect so waitForCallback resolves (and we parse code).
  await fetch(codeLoc, { redirect: 'manual' }).catch(() => {});
  const callback = await callbackPromise;
  if (callback.searchParams.get('state') !== state) {
    console.error('state mismatch');
    process.exit(1);
  }
  const code = callback.searchParams.get('code');
  if (!code) {
    console.error('no code', callback.toString());
    process.exit(1);
  }

  const tokenRes = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    console.error('token exchange failed', tokens);
    process.exit(1);
  }

  writeEnvFile({
    MCP_URL: resource,
    ADN_MCP_ACCESS_TOKEN: tokens.access_token,
    ADN_MCP_REFRESH_TOKEN: tokens.refresh_token || '',
    ADN_MCP_CLIENT_ID: clientId,
  });
  console.log('QA auth OK →', ENV_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

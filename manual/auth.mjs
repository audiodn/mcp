#!/usr/bin/env node
/**
 * Manual OAuth login against a local (or remote) AudioDN MCP server.
 *
 * Prerequisites:
 *   - MCP worker running (`npm run dev:local`) with MCP_DEV_MODE=1 and ADN_API_KEY
 *   - Optional: local API at ADN_API_BASE_URL
 *
 * Usage:
 *   npm run manual:auth
 *   MCP_URL=http://127.0.0.1:8788/mcp npm run manual:auth
 *
 * Writes ADN_MCP_ACCESS_TOKEN / ADN_MCP_REFRESH_TOKEN to manual/.env
 */
import { exec } from 'node:child_process';
import { platform } from 'node:os';
import {
  ENV_PATH,
  issuerFromMcpUrl,
  loadEnvFile,
  mcpBase,
  pkcePair,
  randomToken,
  startLoopbackRedirect,
  writeEnvFile,
} from './lib.mjs';

function openBrowser(url) {
  const cmd =
    platform() === 'darwin'
      ? `open "${url}"`
      : platform() === 'win32'
        ? `start "" "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd);
}

async function main() {
  const env = loadEnvFile();
  const mcpUrl = mcpBase(env);
  const issuer = issuerFromMcpUrl(mcpUrl);
  const resource = mcpUrl;

  console.log(`MCP URL:  ${mcpUrl}`);
  console.log(`Issuer:   ${issuer}`);
  console.log(`Resource: ${resource}`);

  const loopback = await startLoopbackRedirect();
  console.log(`Redirect: ${loopback.redirectUri}`);

  const regRes = await fetch(`${issuer}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: 'AudioDN MCP manual auth',
      redirect_uris: [loopback.redirectUri],
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    }),
  });
  const regBody = await regRes.json();
  if (!regRes.ok) {
    console.error('Dynamic client registration failed:', regBody);
    process.exit(1);
  }
  const clientId = regBody.client_id;
  console.log(`Client:   ${clientId}`);

  const { verifier, challenge } = pkcePair();
  const state = randomToken(16);
  const authorize = new URL(`${issuer}/authorize`);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', loopback.redirectUri);
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('resource', resource);
  authorize.searchParams.set('scope', 'account');

  console.log('\nOpening browser for consent…');
  console.log(authorize.toString());
  openBrowser(authorize.toString());

  const callback = await loopback.waitForCallback();
  if (callback.searchParams.get('state') !== state) {
    console.error('State mismatch');
    process.exit(1);
  }
  const code = callback.searchParams.get('code');
  if (!code) {
    console.error('No authorization code in callback', callback.toString());
    process.exit(1);
  }

  const tokenRes = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: loopback.redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    }).toString(),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok || !tokens.access_token) {
    console.error('Token exchange failed:', tokens);
    process.exit(1);
  }

  writeEnvFile({
    MCP_URL: mcpUrl,
    ADN_MCP_ACCESS_TOKEN: tokens.access_token,
    ADN_MCP_REFRESH_TOKEN: tokens.refresh_token || '',
    ADN_MCP_CLIENT_ID: clientId,
  });

  console.log('\nAuth OK. Tokens written to', ENV_PATH);
  console.log('\nexport ADN_MCP_ACCESS_TOKEN=' + tokens.access_token);
  if (tokens.refresh_token) {
    console.log('export ADN_MCP_REFRESH_TOKEN=' + tokens.refresh_token);
  }
  console.log('\nNext: npm run manual');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

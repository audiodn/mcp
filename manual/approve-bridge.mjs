#!/usr/bin/env node
/**
 * Local stand-in for the approve-mcp-connection edge function.
 *
 * The account app (manage) calls this during `npm run dev` when
 * VITE_MCP_APPROVE_URL is set. It checks the signed-in user against the
 * existing Supabase project, mints an MCP API Access key, and HMAC-posts
 * that key to the local MCP worker. The browser never sees the key.
 *
 * Not used in production. Production consent calls the deployed edge function,
 * which posts to https://mcp.audiodelivery.net/oauth/approve.
 *
 * Env (or the local .dev.vars files this script reads by default):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
 *   MCP_INTERNAL_HMAC
 *   MCP_APPROVE_URL   default http://127.0.0.1:8788/oauth/approve
 *   PORT              default 8790
 */
import { createHmac, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import shortUuid from 'short-uuid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const shortFactory = shortUuid?.default ?? shortUuid;
const translator =
  typeof shortFactory === 'function'
    ? shortFactory()
    : shortFactory.createTranslator();

function loadDevVars(path) {
  if (!existsSync(path)) return;
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
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = value;
    }
  }
}

loadDevVars(
  process.env.ADN_API_DEV_VARS ||
    resolve(__dirname, '../../audiodn-mono/api/.dev.vars'),
);
loadDevVars(process.env.MCP_DEV_VARS || resolve(__dirname, '../.dev.vars'));

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_API_KEY || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const hmacSecret = process.env.MCP_INTERNAL_HMAC || '';
const mcpApproveUrl =
  process.env.MCP_APPROVE_URL || 'http://127.0.0.1:8788/oauth/approve';
const port = Number(process.env.PORT || process.env.MCP_LOCAL_APPROVE_PORT || 8790);

function generateApiKey(length = 48) {
  const bytes = randomBytes(length);
  return [...bytes]
    .map((x) => {
      const i = (x / 255) * 61 | 0;
      return String.fromCharCode(i + (i > 9 ? (i > 35 ? 61 : 55) : 48));
    })
    .join('');
}

function formatApiKey(baseApiKey, organizationId) {
  return `${translator.fromUUID(organizationId)}${baseApiKey}`;
}

function hmacSha256Hex(secret, message) {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-private-network': 'true',
  });
  res.end(payload);
}

async function supabase(path, { key, userJwt, body, method = 'POST' }) {
  const res = await fetch(`${supabaseUrl}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${userJwt || key}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { message: text };
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

async function approve(userJwt, input) {
  const txn = typeof input?.txn === 'string' ? input.txn.trim() : '';
  const organizationId =
    typeof input?.organization_id === 'string' ? input.organization_id.trim() : '';
  const clientName =
    typeof input?.client_name === 'string'
      ? input.client_name.trim().slice(0, 80)
      : 'MCP client';
  if (!txn || txn.length < 8) return { status: 400, body: { message: 'Invalid transaction' } };
  if (!organizationId || organizationId.length < 32) {
    return { status: 400, body: { message: 'Invalid organization' } };
  }

  const user = await supabase('/auth/v1/user', { key: anonKey, userJwt, method: 'GET' });
  const userId = user.body?.id;
  if (!user.ok || !userId) {
    console.error('approve: auth user failed', user.status);
    return { status: 401, body: { message: 'Unauthorized' } };
  }

  const account = await supabase(
    `/rest/v1/account?id=eq.${encodeURIComponent(userId)}&select=id`,
    { key: anonKey, userJwt, method: 'GET' },
  );
  const accountRow = Array.isArray(account.body) ? account.body[0] : null;
  if (!account.ok || !accountRow) {
    console.error('approve: account lookup failed', account.status);
    return { status: 401, body: { message: 'Account Not Found' } };
  }

  const orgs = await supabase('/rest/v1/rpc/list_account_organizations', {
    key: anonKey,
    userJwt,
    body: {},
  });
  if (!orgs.ok) {
    console.error('approve: list organizations failed', orgs.status, orgs.body?.message || orgs.body?.error || '');
    return { status: 400, body: { message: 'Unable to list organizations' } };
  }
  const allowed = (Array.isArray(orgs.body) ? orgs.body : []).some(
    (row) => row?.id === organizationId,
  );
  if (!allowed) {
    return { status: 403, body: { message: 'Organization not allowed for this account' } };
  }

  const baseApiKey = generateApiKey(48);
  const created = await supabase('/rest/v1/rpc/create_api_key', {
    key: serviceKey,
    body: {
      api_key_type_id: 'api',
      organization_id: organizationId,
      creator_id: null,
      collection_id: null,
      track_id: null,
      playlist_id: null,
      title: `MCP · ${clientName}`.slice(0, 120),
      value: baseApiKey,
      organization_index: null,
      metadata: { mcp: true, client_name: clientName, txn_prefix: txn.slice(0, 8) },
      permissions: null,
      variants: null,
      expires_at: null,
    },
  });
  if (!created.ok) {
    console.error(
      'approve: create_api_key failed',
      created.status,
      created.body?.message || created.body?.error || created.body?.hint || '',
    );
    return { status: 500, body: { message: 'Unable to create API Access key' } };
  }
  const keyRow = Array.isArray(created.body) ? created.body[0] : created.body;
  const apiKeyId = keyRow && typeof keyRow === 'object' && keyRow.id ? String(keyRow.id) : '';
  const formattedApiKey = formatApiKey(baseApiKey, organizationId);
  const timestamp = Date.now();
  const message = [txn, organizationId, apiKeyId, String(timestamp), formattedApiKey].join('\n');
  const signature = hmacSha256Hex(hmacSecret, message);

  const approveRes = await fetch(mcpApproveUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      txn,
      organization_id: organizationId,
      api_key: formattedApiKey,
      api_key_id: apiKeyId || undefined,
      timestamp,
      signature,
    }),
  });
  const approveBody = await approveRes.json().catch(() => null);
  if (!approveRes.ok || !approveBody?.redirect_uri) {
    console.error('approve: mcp worker rejected grant', approveRes.status, approveBody?.error || '');
    if (apiKeyId) {
      await supabase(`/rest/v1/api_key?id=eq.${encodeURIComponent(apiKeyId)}`, {
        key: serviceKey,
        method: 'PATCH',
        body: { deleted_at: new Date().toISOString() },
      });
    }
    return { status: 502, body: { message: 'Unable to complete MCP approval' } };
  }
  return {
    status: 200,
    body: { ok: true, success: true, redirect_uri: approveBody.redirect_uri, api_key_id: apiKeyId },
  };
}

function main() {
  const missing = [];
  if (!supabaseUrl) missing.push('SUPABASE_URL');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!hmacSecret) missing.push('MCP_INTERNAL_HMAC');
  if (missing.length) {
    console.error(`Missing ${missing.join(', ')}. Expected them in api/.dev.vars and mcp/.dev.vars.`);
    process.exit(1);
  }

  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      send(res, 204, {});
      return;
    }
    const url = new URL(req.url || '/', `http://127.0.0.1:${port}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { ok: true, mcp_approve_url: mcpApproveUrl });
      return;
    }
    if (req.method !== 'POST' || url.pathname !== '/approve') {
      send(res, 404, { message: 'Not found' });
      return;
    }
    const header = req.headers.authorization || '';
    const userJwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!userJwt) {
      send(res, 401, { message: 'Unauthorized' });
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let input = {};
    try {
      input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      send(res, 400, { message: 'Invalid JSON' });
      return;
    }
    try {
      const result = await approve(userJwt, input);
      send(res, result.status, result.body);
    } catch (err) {
      console.error('approve bridge failed', err instanceof Error ? err.message : 'error');
      send(res, 500, { message: 'Unable to complete MCP approval' });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Local MCP approve bridge http://127.0.0.1:${port}/approve`);
    console.log(`Posts grants to ${mcpApproveUrl}`);
  });
}

main();

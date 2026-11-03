/**
 * OAuth HTTP routes: discovery is handled in handler; this covers
 * /authorize, /token, /register, /oauth/transaction, /oauth/approve,
 * and (dev only) /oauth/dev-consent.
 */

import { normalizeApiKey } from '../../src/api-key.js';
import { ACCESS_TOKEN_TTL_SEC, SCOPE } from './constants.js';
import {
  resolveOAuthConfig,
  resourceMatchesConfigured,
  type OAuthConfigEnv,
} from './config.js';
import {
  redirectUriAllowed,
  registerClient,
  resolveClient,
} from './clients.js';
import {
  encryptSecret,
  hmacSha256Hex,
  randomToken,
  sha256Base64Url,
  signJwt,
  timingSafeEqualHex,
  verifyPkceS256,
} from './crypto.js';
import {
  getTransaction,
  putAuthCode,
  putGrant,
  putRefresh,
  putTransaction,
  takeAuthCode,
  takeRefresh,
  type OAuthKv,
} from './store.js';

export interface OAuthEnv extends OAuthConfigEnv {
  MCP_OAUTH?: OAuthKv;
  MCP_JWT_SECRET?: string;
  MCP_GRANT_ENCRYPTION_KEY?: string;
  MCP_INTERNAL_HMAC?: string;
  ACCOUNT_CONSENT_BASE_URL?: string;
  /** Local MCP_DEV_MODE grant source — never used in production wrangler.toml. */
  ADN_API_KEY?: string;
}

export function oauthConfigured(env: OAuthEnv): boolean {
  return Boolean(
    env.MCP_OAUTH &&
      env.MCP_JWT_SECRET &&
      env.MCP_GRANT_ENCRYPTION_KEY &&
      env.MCP_INTERNAL_HMAC,
  );
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function oauthError(
  error: string,
  status: number,
  description?: string,
): Response {
  return json(
    {
      error,
      ...(description ? { error_description: description } : {}),
    },
    status,
  );
}

async function completeApproval(
  env: OAuthEnv,
  opts: {
    txnId: string;
    organizationId: string;
    apiKey: string;
    apiKeyId?: string;
  },
): Promise<{ redirect_uri: string } | { error: string; status: number }> {
  const { issuer } = resolveOAuthConfig(env);
  const kv = env.MCP_OAUTH!;
  const txn = await getTransaction(kv, opts.txnId);
  if (!txn) {
    return { error: 'Unknown or expired transaction', status: 404 };
  }
  if (txn.connectionId) {
    return { error: 'Transaction already approved', status: 409 };
  }

  const connectionId = randomToken(24);
  const encryptedApiKey = await encryptSecret(
    opts.apiKey,
    env.MCP_GRANT_ENCRYPTION_KEY!,
  );
  await putGrant(kv, {
    connectionId,
    organizationId: opts.organizationId,
    encryptedApiKey,
    clientId: txn.clientId,
    clientName: txn.clientName,
    apiKeyId: opts.apiKeyId,
    createdAt: Date.now(),
  });

  const code = randomToken(32);
  await putAuthCode(kv, {
    code,
    txnId: txn.txnId,
    connectionId,
    clientId: txn.clientId,
    redirectUri: txn.redirectUri,
    codeChallenge: txn.codeChallenge,
    resource: txn.resource,
    scope: txn.scope,
    createdAt: Date.now(),
  });

  txn.connectionId = connectionId;
  txn.organizationId = opts.organizationId;
  await putTransaction(kv, txn);

  const redirect = new URL(txn.redirectUri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', txn.state);
  redirect.searchParams.set('iss', issuer);

  return { redirect_uri: redirect.toString() };
}

/** GET /authorize — start authorization code + PKCE flow. */
export async function handleAuthorize(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  if (!oauthConfigured(env)) {
    return oauthError('server_error', 503, 'OAuth is not configured');
  }
  const { issuer, resource, consentBase, devMode } = resolveOAuthConfig(env);
  const kv = env.MCP_OAUTH!;
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id');
  const redirectUri = url.searchParams.get('redirect_uri');
  const responseType = url.searchParams.get('response_type');
  const codeChallenge = url.searchParams.get('code_challenge');
  const codeChallengeMethod = url.searchParams.get('code_challenge_method');
  const state = url.searchParams.get('state');
  const resourceParam = url.searchParams.get('resource');
  const scope = url.searchParams.get('scope') ?? SCOPE;

  if (responseType !== 'code') {
    return oauthError('unsupported_response_type', 400);
  }
  if (!clientId || !redirectUri || !codeChallenge || !state) {
    return oauthError(
      'invalid_request',
      400,
      'client_id, redirect_uri, code_challenge, and state are required',
    );
  }
  if (codeChallengeMethod !== 'S256') {
    return oauthError(
      'invalid_request',
      400,
      'code_challenge_method must be S256',
    );
  }
  if (!resourceMatchesConfigured(resourceParam, resource)) {
    return oauthError(
      'invalid_target',
      400,
      `resource must be ${resource}`,
    );
  }
  if (scope.split(/\s+/).filter(Boolean).some((s) => s !== SCOPE)) {
    return oauthError('invalid_scope', 400, `supported scope: ${SCOPE}`);
  }

  const client = await resolveClient(kv, clientId);
  if (!client) {
    return oauthError('invalid_client', 400, 'Unknown client_id');
  }
  if (!redirectUriAllowed(client, redirectUri)) {
    return oauthError('invalid_request', 400, 'redirect_uri is not registered');
  }

  const txnId = randomToken(24);
  await putTransaction(kv, {
    txnId,
    clientId,
    clientName: client.clientName,
    redirectUri,
    codeChallenge,
    codeChallengeMethod: 'S256',
    state,
    resource,
    scope: SCOPE,
    createdAt: Date.now(),
  });

  if (devMode) {
    const consent = new URL('/oauth/dev-consent', issuer);
    consent.searchParams.set('txn', txnId);
    return Response.redirect(consent.toString(), 302);
  }

  const consent = new URL(consentBase);
  consent.searchParams.set('txn', txnId);
  return Response.redirect(consent.toString(), 302);
}

/** GET /oauth/transaction?txn= — public consent UI metadata (no secrets). */
export async function handleTransactionInfo(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  if (!oauthConfigured(env)) {
    return oauthError('server_error', 503, 'OAuth is not configured');
  }
  const txnId = new URL(request.url).searchParams.get('txn');
  if (!txnId) return oauthError('invalid_request', 400, 'txn is required');
  const txn = await getTransaction(env.MCP_OAUTH!, txnId);
  if (!txn) return oauthError('invalid_request', 404, 'Unknown or expired transaction');
  let redirectHost = '';
  try {
    redirectHost = new URL(txn.redirectUri).host;
  } catch {
    redirectHost = '';
  }
  return json({
    txn: txn.txnId,
    client_name: txn.clientName,
    client_id: txn.clientId,
    redirect_host: redirectHost,
    redirect_uri: txn.redirectUri,
    scope: txn.scope,
  });
}

/**
 * GET|POST /oauth/dev-consent — local-only consent that grants env.ADN_API_KEY.
 * Only registered when MCP_DEV_MODE=1.
 */
export async function handleDevConsent(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  const { devMode, issuer } = resolveOAuthConfig(env);
  if (!devMode) {
    return new Response('Not found', { status: 404 });
  }
  if (!oauthConfigured(env)) {
    return oauthError('server_error', 503, 'OAuth is not configured');
  }

  if (request.method === 'GET') {
    const txnId = new URL(request.url).searchParams.get('txn');
    if (!txnId) return new Response('Missing txn', { status: 400 });
    const txn = await getTransaction(env.MCP_OAUTH!, txnId);
    if (!txn) {
      return new Response('Unknown or expired transaction', { status: 404 });
    }
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Local MCP consent</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; max-width: 480px; margin: 2rem auto; padding: 0 1rem; }
  code { background: #eee; padding: 0.1rem 0.35rem; border-radius: 4px; }
  button { font: inherit; padding: 0.5rem 1rem; cursor: pointer; }
  .deny { background: transparent; border: 1px solid #999; margin-right: 0.5rem; }
  .allow { background: #2563eb; color: #fff; border: none; }
  .warn { background: #fff7ed; border: 1px solid #fdba74; padding: 0.75rem; border-radius: 8px; margin: 1rem 0; }
</style>
</head>
<body>
  <h1>Local MCP consent</h1>
  <p class="warn"><strong>Dev mode only.</strong> Allow grants the API Access key from this worker’s
  <code>ADN_API_KEY</code> to <strong>${escapeHtml(txn.clientName)}</strong>
  (redirect <code>${escapeHtml(new URL(txn.redirectUri).host)}</code>).</p>
  <form method="post" action="/oauth/dev-consent">
    <input type="hidden" name="txn" value="${escapeHtml(txnId)}" />
    <button class="deny" type="submit" name="decision" value="deny">Deny</button>
    <button class="allow" type="submit" name="decision" value="allow">Allow</button>
  </form>
  <p style="opacity:.6;font-size:.85rem;margin-top:2rem">Issuer <code>${escapeHtml(issuer)}</code></p>
</body>
</html>`;
    return new Response(html, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (request.method !== 'POST') {
    return oauthError('invalid_request', 405);
  }

  const form = await request.formData();
  const txnId = String(form.get('txn') || '');
  const decision = String(form.get('decision') || '');
  if (!txnId) return new Response('Missing txn', { status: 400 });

  if (decision === 'deny') {
    return new Response('Denied. You can close this tab.', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  const apiKey = normalizeApiKey(env.ADN_API_KEY);
  if (!apiKey) {
    return new Response(
      'MCP_DEV_MODE requires ADN_API_KEY in the worker .dev.vars',
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const result = await completeApproval(env, {
    txnId,
    organizationId: '00000000-0000-4000-8000-000000000000',
    apiKey,
  });
  if ('error' in result) {
    return new Response(result.error, { status: result.status });
  }
  return Response.redirect(result.redirect_uri, 302);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

/**
 * POST /oauth/approve — internal: account edge function delivers the minted
 * API Access key after user consent. Authenticated via HMAC.
 */
export async function handleApprove(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  if (!oauthConfigured(env)) {
    return oauthError('server_error', 503, 'OAuth is not configured');
  }
  if (request.method !== 'POST') {
    return oauthError('invalid_request', 405);
  }

  const body = (await request.json().catch(() => null)) as {
    txn?: string;
    organization_id?: string;
    api_key?: string;
    api_key_id?: string;
    timestamp?: number;
    signature?: string;
  } | null;

  if (
    !body?.txn ||
    !body.organization_id ||
    !body.api_key ||
    !body.timestamp ||
    !body.signature
  ) {
    return oauthError('invalid_request', 400, 'Missing approve fields');
  }

  // Reject stale signatures (5 minute skew).
  if (Math.abs(Date.now() - body.timestamp) > 5 * 60 * 1000) {
    return oauthError('invalid_request', 401, 'Stale signature');
  }

  const payload = [
    body.txn,
    body.organization_id,
    body.api_key_id ?? '',
    String(body.timestamp),
  ].join('\n');
  const message = `${payload}\n${body.api_key}`;
  const expected = await hmacSha256Hex(env.MCP_INTERNAL_HMAC!, message);
  if (!(await timingSafeEqualHex(expected, body.signature))) {
    return oauthError('invalid_request', 401, 'Invalid signature');
  }

  const result = await completeApproval(env, {
    txnId: body.txn,
    organizationId: body.organization_id,
    apiKey: body.api_key,
    apiKeyId: body.api_key_id,
  });
  if ('error' in result) {
    return oauthError('invalid_request', result.status, result.error);
  }
  return json({ ok: true, redirect_uri: result.redirect_uri });
}

async function parseTokenBody(
  request: Request,
): Promise<Record<string, string>> {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(body)) {
      if (typeof v === 'string') out[k] = v;
    }
    return out;
  }
  const text = await request.text();
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

async function issueTokens(
  env: OAuthEnv,
  opts: {
    connectionId: string;
    clientId: string;
    resource: string;
    scope: string;
  },
): Promise<Response> {
  const { issuer, resource } = resolveOAuthConfig(env);
  const now = Math.floor(Date.now() / 1000);
  const accessToken = await signJwt(
    {
      iss: issuer,
      aud: resource,
      sub: opts.connectionId,
      client_id: opts.clientId,
      scope: opts.scope,
      iat: now,
      exp: now + ACCESS_TOKEN_TTL_SEC,
    },
    env.MCP_JWT_SECRET!,
  );
  const refreshToken = randomToken(48);
  const refreshHash = await sha256Base64Url(refreshToken);
  await putRefresh(env.MCP_OAUTH!, refreshHash, {
    connectionId: opts.connectionId,
    clientId: opts.clientId,
    resource: opts.resource,
    scope: opts.scope,
  });

  return json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SEC,
    refresh_token: refreshToken,
    scope: opts.scope,
  });
}

/** POST /token — authorization_code or refresh_token. */
export async function handleToken(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  if (!oauthConfigured(env)) {
    return oauthError('server_error', 503, 'OAuth is not configured');
  }
  if (request.method !== 'POST') {
    return oauthError('invalid_request', 405);
  }
  const { resource: configuredResource } = resolveOAuthConfig(env);
  const body = await parseTokenBody(request);
  const grantType = body.grant_type;

  if (grantType === 'authorization_code') {
    const code = body.code;
    const redirectUri = body.redirect_uri;
    const clientId = body.client_id;
    const codeVerifier = body.code_verifier;
    const resource = body.resource;

    if (!code || !redirectUri || !clientId || !codeVerifier) {
      return oauthError('invalid_request', 400, 'Missing token request fields');
    }
    if (!resourceMatchesConfigured(resource ?? configuredResource, configuredResource)) {
      return oauthError(
        'invalid_target',
        400,
        `resource must be ${configuredResource}`,
      );
    }

    const record = await takeAuthCode(env.MCP_OAUTH!, code);
    if (!record) return oauthError('invalid_grant', 400, 'Invalid or expired code');
    if (record.clientId !== clientId || record.redirectUri !== redirectUri) {
      return oauthError('invalid_grant', 400, 'Code mismatch');
    }
    if (!(await verifyPkceS256(codeVerifier, record.codeChallenge))) {
      return oauthError('invalid_grant', 400, 'PKCE verification failed');
    }

    return issueTokens(env, {
      connectionId: record.connectionId,
      clientId: record.clientId,
      resource: record.resource,
      scope: record.scope,
    });
  }

  if (grantType === 'refresh_token') {
    const refreshToken = body.refresh_token;
    const clientId = body.client_id;
    const resource = body.resource;
    if (!refreshToken || !clientId) {
      return oauthError('invalid_request', 400, 'Missing refresh fields');
    }
    if (resource && !resourceMatchesConfigured(resource, configuredResource)) {
      return oauthError(
        'invalid_target',
        400,
        `resource must be ${configuredResource}`,
      );
    }
    const hash = await sha256Base64Url(refreshToken);
    const record = await takeRefresh(env.MCP_OAUTH!, hash);
    if (!record) return oauthError('invalid_grant', 400, 'Invalid refresh token');
    if (record.clientId !== clientId) {
      return oauthError('invalid_grant', 400, 'Client mismatch');
    }
    return issueTokens(env, {
      connectionId: record.connectionId,
      clientId: record.clientId,
      resource: record.resource,
      scope: record.scope,
    });
  }

  return oauthError('unsupported_grant_type', 400);
}

/** POST /register — RFC 7591 Dynamic Client Registration. */
export async function handleRegister(
  request: Request,
  env: OAuthEnv,
): Promise<Response> {
  if (!oauthConfigured(env)) {
    return oauthError('server_error', 503, 'OAuth is not configured');
  }
  if (request.method !== 'POST') {
    return oauthError('invalid_request', 405);
  }
  const body = (await request.json().catch(() => ({}))) as {
    client_name?: string;
    redirect_uris?: string[];
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
  };
  const result = await registerClient(env.MCP_OAUTH!, body);
  if ('error' in result) {
    return oauthError(result.error, result.status);
  }
  return json(
    {
      client_id: result.clientId,
      client_name: result.clientName,
      redirect_uris: result.redirectUris,
      token_endpoint_auth_method: result.tokenEndpointAuthMethod,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(result.createdAt / 1000),
    },
    201,
  );
}

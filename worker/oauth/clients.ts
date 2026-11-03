/**
 * Client identity: Client ID Metadata Documents (preferred) + Dynamic Client Registration.
 */

import { getClient, putClient, type OAuthKv, type RegisteredClient } from './store.js';
import { randomToken } from './crypto.js';

const MAX_METADATA_BYTES = 64_000;
const FETCH_TIMEOUT_MS = 5_000;

export interface ResolvedClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

function isPrivateHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1') {
    return true;
  }
  // Block obvious private / link-local IPv4 literals.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const parts = h.split('.').map(Number);
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

function isAllowedRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    if (
      u.protocol === 'http:' &&
      (u.hostname === '127.0.0.1' ||
        u.hostname === 'localhost' ||
        u.hostname === '[::1]')
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Fetch and validate a Client ID Metadata Document (URL-shaped client_id). */
export async function resolveClientIdMetadata(
  clientId: string,
): Promise<ResolvedClient | null> {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!url.pathname || url.pathname === '/') return null;
  if (isPrivateHostname(url.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_METADATA_BYTES) return null;
    const doc = JSON.parse(new TextDecoder().decode(buf)) as {
      client_id?: string;
      client_name?: string;
      redirect_uris?: string[];
    };
    if (doc.client_id !== clientId) return null;
    if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) {
      return null;
    }
    const redirectUris = doc.redirect_uris.filter(isAllowedRedirectUri);
    if (redirectUris.length === 0) return null;
    return {
      clientId,
      clientName:
        typeof doc.client_name === 'string' && doc.client_name.trim()
          ? doc.client_name.trim()
          : 'MCP client',
      redirectUris,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveClient(
  kv: OAuthKv,
  clientId: string,
): Promise<ResolvedClient | null> {
  if (clientId.startsWith('https://')) {
    return resolveClientIdMetadata(clientId);
  }
  const registered = await getClient(kv, clientId);
  if (!registered) return null;
  return {
    clientId: registered.clientId,
    clientName: registered.clientName,
    redirectUris: registered.redirectUris,
  };
}

export async function registerClient(
  kv: OAuthKv,
  body: {
    client_name?: string;
    redirect_uris?: string[];
    token_endpoint_auth_method?: string;
    grant_types?: string[];
    response_types?: string[];
  },
): Promise<RegisteredClient | { error: string; status: number }> {
  const redirectUris = (body.redirect_uris ?? []).filter(isAllowedRedirectUri);
  if (redirectUris.length === 0) {
    return { error: 'invalid_redirect_uri', status: 400 };
  }
  const client: RegisteredClient = {
    clientId: `dcr_${randomToken(16)}`,
    clientName:
      typeof body.client_name === 'string' && body.client_name.trim()
        ? body.client_name.trim().slice(0, 128)
        : 'MCP client',
    redirectUris,
    tokenEndpointAuthMethod: body.token_endpoint_auth_method ?? 'none',
    createdAt: Date.now(),
  };
  await putClient(kv, client);
  return client;
}

export function redirectUriAllowed(
  client: ResolvedClient,
  redirectUri: string,
): boolean {
  return client.redirectUris.includes(redirectUri);
}

/**
 * KV-backed OAuth state (transactions, codes, grants, refresh tokens, clients).
 * Uses Cloudflare KV when available; tests can inject a Map-backed fake.
 */

import {
  AUTH_CODE_TTL_SEC,
  CLIENT_REG_TTL_SEC,
  REFRESH_TOKEN_TTL_SEC,
  TXN_TTL_SEC,
} from './constants.js';

export interface OAuthKv {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-memory KV for unit tests. */
export function createMemoryKv(): OAuthKv {
  const map = new Map<string, { value: string; expiresAt?: number }>();
  return {
    async get(key) {
      const row = map.get(key);
      if (!row) return null;
      if (row.expiresAt && row.expiresAt <= Date.now()) {
        map.delete(key);
        return null;
      }
      return row.value;
    },
    async put(key, value, options) {
      map.set(key, {
        value,
        expiresAt: options?.expirationTtl
          ? Date.now() + options.expirationTtl * 1000
          : undefined,
      });
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

export interface AuthTransaction {
  txnId: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  state: string;
  resource: string;
  scope: string;
  createdAt: number;
  /** Filled after consent approval. */
  connectionId?: string;
  organizationId?: string;
}

export interface GrantRecord {
  connectionId: string;
  organizationId: string;
  /** AES-GCM packed ciphertext of the API Access key. */
  encryptedApiKey: string;
  clientId: string;
  clientName: string;
  apiKeyId?: string;
  createdAt: number;
}

export interface RegisteredClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  tokenEndpointAuthMethod: string;
  createdAt: number;
}

export interface AuthCodeRecord {
  code: string;
  txnId: string;
  connectionId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  createdAt: number;
}

export interface RefreshRecord {
  connectionId: string;
  clientId: string;
  resource: string;
  scope: string;
}

function txnKey(id: string) {
  return `txn:${id}`;
}
function codeKey(code: string) {
  return `code:${code}`;
}
function grantKey(id: string) {
  return `grant:${id}`;
}
function refreshKey(hash: string) {
  return `refresh:${hash}`;
}
function clientKey(id: string) {
  return `client:${id}`;
}

export async function putTransaction(
  kv: OAuthKv,
  txn: AuthTransaction,
): Promise<void> {
  await kv.put(txnKey(txn.txnId), JSON.stringify(txn), {
    expirationTtl: TXN_TTL_SEC,
  });
}

export async function getTransaction(
  kv: OAuthKv,
  txnId: string,
): Promise<AuthTransaction | null> {
  const raw = await kv.get(txnKey(txnId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthTransaction;
  } catch {
    return null;
  }
}

export async function putAuthCode(
  kv: OAuthKv,
  record: AuthCodeRecord,
): Promise<void> {
  await kv.put(codeKey(record.code), JSON.stringify(record), {
    expirationTtl: AUTH_CODE_TTL_SEC,
  });
}

export async function takeAuthCode(
  kv: OAuthKv,
  code: string,
): Promise<AuthCodeRecord | null> {
  const raw = await kv.get(codeKey(code));
  if (!raw) return null;
  await kv.delete(codeKey(code));
  try {
    return JSON.parse(raw) as AuthCodeRecord;
  } catch {
    return null;
  }
}

export async function putGrant(kv: OAuthKv, grant: GrantRecord): Promise<void> {
  // Grants live until the API key is deleted / refresh expires; use long TTL.
  await kv.put(grantKey(grant.connectionId), JSON.stringify(grant), {
    expirationTtl: REFRESH_TOKEN_TTL_SEC,
  });
}

export async function getGrant(
  kv: OAuthKv,
  connectionId: string,
): Promise<GrantRecord | null> {
  const raw = await kv.get(grantKey(connectionId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GrantRecord;
  } catch {
    return null;
  }
}

export async function deleteGrant(
  kv: OAuthKv,
  connectionId: string,
): Promise<void> {
  await kv.delete(grantKey(connectionId));
}

export async function putRefresh(
  kv: OAuthKv,
  tokenHash: string,
  record: RefreshRecord,
): Promise<void> {
  await kv.put(refreshKey(tokenHash), JSON.stringify(record), {
    expirationTtl: REFRESH_TOKEN_TTL_SEC,
  });
}

export async function takeRefresh(
  kv: OAuthKv,
  tokenHash: string,
): Promise<RefreshRecord | null> {
  const raw = await kv.get(refreshKey(tokenHash));
  if (!raw) return null;
  await kv.delete(refreshKey(tokenHash));
  try {
    return JSON.parse(raw) as RefreshRecord;
  } catch {
    return null;
  }
}

export async function putClient(
  kv: OAuthKv,
  client: RegisteredClient,
): Promise<void> {
  await kv.put(clientKey(client.clientId), JSON.stringify(client), {
    expirationTtl: CLIENT_REG_TTL_SEC,
  });
}

export async function getClient(
  kv: OAuthKv,
  clientId: string,
): Promise<RegisteredClient | null> {
  const raw = await kv.get(clientKey(clientId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RegisteredClient;
  } catch {
    return null;
  }
}

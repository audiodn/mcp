/**
 * Resolve an incoming Bearer credential to an AudioDN API Access key.
 * Supports OAuth access tokens (JWT) and legacy API Access keys.
 */

import { normalizeApiKey } from '../../src/api-key.js';
import { SCOPE } from './constants.js';
import {
  resolveOAuthConfig,
  type OAuthConfigEnv,
} from './config.js';
import {
  decryptSecret,
  looksLikeJwt,
  verifyJwt,
} from './crypto.js';
import { deleteGrant, getGrant, type OAuthKv } from './store.js';

export interface ResolveAuthResult {
  apiKey?: string;
  connectionId?: string;
  /** True when the request had a Bearer/API-key header that failed validation. */
  invalid?: boolean;
}

export interface OAuthSecrets {
  jwtSecret: string;
  grantEncryptionKey: string;
}

/**
 * Read Authorization / X-ADN-API-Key and resolve to a plaintext API Access key.
 * OAuth JWTs are never forwarded to the AudioDN API — only the stored grant key is.
 */
export async function resolveRequestAuth(
  request: Request,
  opts: {
    kv?: OAuthKv;
    secrets?: OAuthSecrets;
    configEnv?: OAuthConfigEnv;
  },
): Promise<ResolveAuthResult> {
  const raw = readBearerOrApiKeyHeader(request);
  if (!raw) return {};

  const { issuer, resource } = resolveOAuthConfig(opts.configEnv);

  if (looksLikeJwt(raw)) {
    if (!opts.kv || !opts.secrets) {
      return { invalid: true };
    }
    const payload = await verifyJwt(raw, opts.secrets.jwtSecret);
    if (!payload) return { invalid: true };
    if (payload.iss !== issuer) return { invalid: true };
    if (payload.aud !== resource) return { invalid: true };
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    if (!scope.split(/\s+/).includes(SCOPE)) return { invalid: true };
    const connectionId =
      typeof payload.sub === 'string' ? payload.sub : undefined;
    if (!connectionId) return { invalid: true };

    const grant = await getGrant(opts.kv, connectionId);
    if (!grant) return { invalid: true };
    const apiKey = await decryptSecret(
      grant.encryptedApiKey,
      opts.secrets.grantEncryptionKey,
    );
    if (!apiKey) {
      await deleteGrant(opts.kv, connectionId);
      return { invalid: true };
    }
    return { apiKey, connectionId };
  }

  // Legacy bring-your-own API Access key.
  const apiKey = normalizeApiKey(raw);
  if (!apiKey) return {};
  return { apiKey };
}

export function readBearerOrApiKeyHeader(request: Request): string | undefined {
  const direct = request.headers.get('x-adn-api-key');
  if (direct) {
    const normalized = normalizeApiKey(direct);
    if (normalized) return normalized;
  }
  const auth = request.headers.get('authorization');
  if (auth) {
    const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (match) {
      const value = match[1]!.trim();
      // Keep JWT raw (normalizeApiKey would still pass it through).
      if (looksLikeJwt(value)) return value;
      return normalizeApiKey(value);
    }
  }
  return undefined;
}

/**
 * Resolve OAuth issuer / resource from worker env, with production defaults.
 */

import {
  CANONICAL_RESOURCE as DEFAULT_RESOURCE,
  DEFAULT_CONSENT_BASE,
  ISSUER as DEFAULT_ISSUER,
} from './constants.js';

export interface OAuthPublicConfig {
  issuer: string;
  resource: string;
  consentBase: string;
  /** When true, /authorize uses same-origin /oauth/dev-consent. */
  devMode: boolean;
}

export interface OAuthConfigEnv {
  MCP_ISSUER?: string;
  MCP_RESOURCE?: string;
  ACCOUNT_CONSENT_BASE_URL?: string;
  MCP_DEV_MODE?: string;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export function resolveOAuthConfig(env: OAuthConfigEnv = {}): OAuthPublicConfig {
  const issuer = stripTrailingSlash(
    (env.MCP_ISSUER || DEFAULT_ISSUER).trim() || DEFAULT_ISSUER,
  );
  const resource = stripTrailingSlash(
    (env.MCP_RESOURCE || DEFAULT_RESOURCE).trim() || DEFAULT_RESOURCE,
  );
  const consentBase = stripTrailingSlash(
    (env.ACCOUNT_CONSENT_BASE_URL || DEFAULT_CONSENT_BASE).trim() ||
      DEFAULT_CONSENT_BASE,
  );
  return {
    issuer,
    resource,
    consentBase,
    devMode: env.MCP_DEV_MODE === '1',
  };
}

export function normalizeResourceUri(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

export function resourceMatchesConfigured(
  value: string | null | undefined,
  resource: string,
): boolean {
  return normalizeResourceUri(value) === stripTrailingSlash(resource);
}

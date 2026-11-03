/** Canonical MCP resource URI (RFC 8707 / MCP authorization). */
export const CANONICAL_RESOURCE = 'https://mcp.audiodelivery.net/mcp';

/** OAuth issuer / authorization server base. */
export const ISSUER = 'https://mcp.audiodelivery.net';

/** Account dashboard consent path (txn query appended by authorize). */
export const DEFAULT_CONSENT_BASE =
  'https://account.audiodeliverynetwork.com/connect/mcp';

export const SCOPE = 'account';

export const ACCESS_TOKEN_TTL_SEC = 15 * 60;
export const REFRESH_TOKEN_TTL_SEC = 30 * 24 * 60 * 60;
export const AUTH_CODE_TTL_SEC = 10 * 60;
export const TXN_TTL_SEC = 15 * 60;
export const CLIENT_REG_TTL_SEC = 90 * 24 * 60 * 60;

export const PRM_PATH = '/.well-known/oauth-protected-resource';
export const PRM_MCP_PATH = '/.well-known/oauth-protected-resource/mcp';
export const AS_META_PATH = '/.well-known/oauth-authorization-server';
export const JWKS_PATH = '/.well-known/jwks.json';

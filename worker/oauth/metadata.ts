import { JWKS_PATH, SCOPE } from './constants.js';
import { resolveOAuthConfig, type OAuthConfigEnv } from './config.js';

export function protectedResourceMetadata(env: OAuthConfigEnv = {}) {
  const { issuer, resource } = resolveOAuthConfig(env);
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://audiodeliverynetwork.com/docs/mcp',
  };
}

export function authorizationServerMetadata(env: OAuthConfigEnv = {}) {
  const { issuer } = resolveOAuthConfig(env);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    registration_endpoint: `${issuer}/register`,
    jwks_uri: `${issuer}${JWKS_PATH}`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: [SCOPE],
    client_id_metadata_document_supported: true,
    resource_parameter_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** HS256 has no public JWKS keys; advertise empty set (clients use opaque validation via AS). */
export function jwksDocument() {
  return { keys: [] as unknown[] };
}

export function unauthorizedWwwAuthenticate(env: OAuthConfigEnv = {}): string {
  const { issuer } = resolveOAuthConfig(env);
  return `Bearer realm="mcp", resource_metadata="${issuer}/.well-known/oauth-protected-resource", scope="${SCOPE}"`;
}

export function unauthorizedResponse(
  message = 'Authorization required',
  env: OAuthConfigEnv = {},
): Response {
  return new Response(JSON.stringify({ error: 'unauthorized', message }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': unauthorizedWwwAuthenticate(env),
      'cache-control': 'no-store',
    },
  });
}

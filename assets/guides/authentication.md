# Authentication

AudioDN uses these credential types:

- **API Access key** (`Bearer` token): full server-side access. Server-only.
  Used to create upload sessions, read track status, mint play sessions, and
  create scoped keys. Local stdio MCP (`npx @audiodn/mcp`) uses this via
  `ADN_API_KEY`. Hosted MCP preferably uses **OAuth account login** instead
  (see below); a legacy API Access key as Bearer still works. API Access keys
  are created in the dashboard (or automatically titled `MCP · …` when you
  approve a hosted MCP connection). The first 22 characters of the key are a
  short-uuid encoding of `organization_id` (`adn_get_organization` derives it
  when omitted).
- **MCP OAuth (hosted)**: remote MCP clients follow the MCP authorization
  specification (OAuth 2.1 authorization code + PKCE). The client opens your
  AudioDN account consent page; Allow mints a revocable API Access key for the
  selected organization. The MCP worker stores that key encrypted and issues
  short-lived access tokens audience-bound to
  `https://mcp.audiodelivery.net/mcp`. OAuth tokens are never forwarded to the
  AudioDN REST API.
- **Client-Side keys** (`player` / `uploader`): resource-scoped keys that are
  safe to ship in a browser or app. They work with the web components **and**
  with custom clients that call the session routes directly
  (`mwAuthorizePlay` / `mwAuthorizeUpload`). Mint them with
  `POST /v1/api_key` / `adn_create_client_key` using an API Access key, or from
  the dashboard. The full key is returned **once** — do not commit or log it.
- **Inline Share key** (`share`): path credential for
  `GET /v1/stream/{track_id}/{share_key}` (302 to a signed CDN URL). Requires
  exactly one output index in `variants`; `expires_at` is ignored. Creatable via
  `POST /v1/api_key` / `adn_create_client_key` or the dashboard.
- **URL Signing key**: HMAC secret for signed delivery URLs. Dashboard-only;
  there is no API to mint it. Never ship it to a client.
- **Session IDs as capability tokens**: some endpoints are authorized by a
  session ID in the URL instead of a Bearer token and take **no** Authorization
  header:
  - `GET /v1/upload_session/{upload_session_id}`
  - `POST /v1/upload/{upload_session_id}/track`
  - `GET /v1/play_session/{play_session_id}`
  - `GET /v1/play/{play_session_id}/{play_track_id}`
  - `GET /v1/play/{play_session_id}/{play_track_id}/{variant_index}/download`

Rule: never ship an API Access key or URL Signing secret to a browser, mobile
app, or committed file. Client-side Player/Uploader keys are limited credentials
for their documented scopes. Do not set both an `api-key` attribute and a
session ID on a component, and do not feed signed URLs to the ADN Player.

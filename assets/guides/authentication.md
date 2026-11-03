# Authentication

AudioDN uses these credential types:

- **API Access key** (`Bearer` token): full server-side access. Server-only.
  Used to create upload sessions, read track status, mint play sessions, and
  create scoped keys. This is the key the MCP server itself runs with
  (`ADN_API_KEY`). API Access keys are created only in the dashboard.
- **Client-Side keys** (`player` / `uploader`): resource-scoped keys that are
  safe to ship in a browser or app. They work with the web components **and**
  with custom clients that call the session routes directly
  (`mwAuthorizePlay` / `mwAuthorizeUpload`). Mint them with
  `POST /v1/api_key` using an API Access key, or from the dashboard.
- **Inline Share key** (`share`): path credential for
  `GET /v1/stream/{track_id}/{share_key}` (302 to a signed CDN URL). Requires
  exactly one variant; `expires_at` is ignored. Creatable via
  `POST /v1/api_key` or the dashboard.
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

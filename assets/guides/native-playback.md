# Native / app playback

Match the **ask** first, then the surface. Keywords: native, mobile, iOS,
Android, Flutter, React Native, signed url, pre-sign, long-lived url, access
output.

## Match the ask

1. **"Play this track / version / output in my app"** (no raw-URL ask) →
   Client-Side Player key + play session. Default for mobile/native.
2. **"Give me a long-lived URL I can hand to my player"** → play-session URLs
   are short-lived. For long-lived / play-session-free delivery, create a
   **URL Signing** key (dashboard) and sign your own URLs server-side.
3. **"How do I pre-sign URLs so I skip play sessions?"** → same URL Signing key
   path + the timed-HMAC recipe below.

A "signed URL for a track" is normally a **play-session response**
(`first_track.variants[].url`). Prefer short-lived sessions the client
refreshes. Only reach for a URL Signing key when the user explicitly wants
long-lived or play-session-free signing — and only from a server.

## Default: play this output (no raw-URL ask)

### Web page

Player component + scoped Client-Side Player key. See the `web-components`
guide and `adn_build_player_embed`. Or mint a play session server-side (API
Access key) and pass `play-session-id` to the component. Never both; never a
signed URL on the ADN Player; never an API Access key in the page.

### Mobile / native app

Ship a scoped Client-Side **Player** key (`adn_create_client_key`,
`api_key_type_id: "player"`). It only creates play sessions — safe if leaked
relative to an API Access key. Do **not** put a URL Signing secret or API
Access key in the app.

Recipe:

1. Gate on processing readiness (`adn_wait_for_processing` / track ready).
2. App calls `POST /v1/play_session/{scope}` with Bearer = Player key and a
   non-empty `variants` list of output indexes (e.g. `["hq","lq"]`).
3. Play `first_track.variants[].url` (HMAC-signed CDN URLs).
4. More tracks: `GET /v1/play/{play_session_id}/{play_track_id}` (no Bearer).
5. Downloads (when the session was created with `is_downloadable: true`):
   `GET /v1/play/{play_session_id}/{play_track_id}/{variant_index}/download`.
6. Refresh the play session when it expires — do not embed long-lived HMAC
   URLs in the app.

MCP tools: `adn_create_client_key` (player), `adn_create_play_session`,
`adn_get_play_track`, `adn_get_play_download`.

### Your own server / backend

Mint play sessions with an API Access key and hand the signed URLs (or
`play_session_id`) to the client. Or use URL Signing (below) when you
explicitly want to skip play sessions.

## Explicit long-lived / pre-sign (skip play sessions)

Use a **URL Signing** key (HMAC). It is **dashboard-only by design** —
creating one provisions an edge WAF rule the REST API does not manage.
`adn_create_client_key` cannot mint it (`player` / `uploader` / `share` only).
Create the key in the AudioDN dashboard under Settings → API Keys →
**URL Signing**. You are shown the secret once; store it on your server.
Optional `ttl` (default **10800** seconds) and optional variant-index scope.

Then sign delivery URLs **on your server** (never inside an app):

1. Build the file URL from the durable `track.base_url` plus the delivery
   index and extension: `{base_url}_{index}.{ext}`
   (e.g. `https://{org}.audiodelivery.net/.../…_lq.mp3`). Persist `base_url`
   at track creation — never store ephemeral signed URLs.
2. Let `path` be the URL pathname (plus any existing query string excluding
   `verify`).
3. `issued` = Unix timestamp in seconds (string).
4. `mac` = HMAC-SHA256(secret, `path + issued`), then URL-safe Base64 with no
   padding (base64url).
5. Append `?verify={issued}-{base64url_mac}` — the `verify` param must be
   **last**.

Valid within the key's `ttl`; the edge validates with
`is_timed_hmac_valid_v0`. Anyone with a valid signed URL can stream until
expiry; every request still counts toward play usage. Do not feed these URLs
to the ADN Player component.

Canonical docs: https://audiodeliverynetwork.com/docs/api/signing-keys

## Cross-refs

`authentication` (credential types), `playback` (sessions + downloads),
`web-components` (player embed).

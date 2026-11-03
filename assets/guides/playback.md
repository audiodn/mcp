# Playback and delivery

Two supported ways to deliver audio, both gated by readiness:

- **Play sessions**: `POST /v1/play_session/{scope}` (server, Bearer) requires a
  non-empty `variants` list of delivery indexes (from `GET /v1/variant` /
  `adn_list_variants`). Returns `play_session_id`, `tracks`, and
  `first_track.variants[].url` plus waveform `levels`. Pass the session ID to
  the ADN Player; use signed URLs only with a custom player. `scope` is
  `collection` or `track` (playlist is unsupported). Fetch additional tracks with
  `GET /v1/play/{play_session_id}/{play_track_id}` (no Bearer).
  (MCP tools: `adn_create_play_session`, `adn_get_play_session`,
  `adn_get_play_track`.)
- **Signed delivery**: sign a delivery URL on your server with a URL Signing key
  (HMAC-SHA256; the `verify` query param must be appended **last**). Skips play
  sessions for public/entitled tracks. The signing secret is server-only. Build
  the URL from the durable `track.base_url` returned at track creation, plus the
  variant suffix and extension (e.g. `{base_url}_lq.mp3`).
- **Inline share**: `GET /v1/stream/{track_id}/{share_key}` redirects (302) to a
  signed CDN URL for a share key's single variant. No Bearer header.

For components, pass a Client-Side Player key **or** a server-provisioned play
session ID to `<audiodn-player>` — never both, and never a signed URL. Never
expose the API Access key to the client.

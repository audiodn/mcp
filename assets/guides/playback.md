# Playback and delivery

Two supported ways to deliver audio, both gated by readiness:

- **Play sessions**: `POST /v1/play_session/{scope}` (server, Bearer) returns
  signed variant URLs in `first_track.variants[].url` plus waveform `levels`.
  `scope` is `collection` or `track` (playlist is reserved and currently returns
  400). Fetch additional tracks with `GET /v1/play/{play_session_id}/{play_track_id}`
  (no Bearer). Best for per-listener authorization and short expiry.
  (MCP tools: `adn_create_play_session`, `adn_get_play_session`.)
- **Signed delivery**: sign a delivery URL on your server with a URL Signing key
  (HMAC-SHA256; the `verify` query param must be appended **last**). Skips play
  sessions for public/entitled tracks. The signing secret is server-only. Build
  the URL from the durable `track.base_url` returned at track creation, plus the
  variant suffix and extension (e.g. `{base_url}_128.mp3`).

For components, pass a Client-Side Player key or a server-provisioned play
session ID to `<audiodn-player>`. Never expose the API Access key to the client.

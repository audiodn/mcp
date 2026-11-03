# Playback and delivery

Two supported ways to deliver audio, both gated by readiness:

- **Play sessions**: `POST /v1/play_session/{scope}` (server, Bearer) requires a
  non-empty `variants` list of **output indexes** (from `GET /v1/output_preset` /
  `adn_list_output_presets`; legacy path `GET /v1/variant`). The `variants` body
  field is the historical wire key for those indexes; the API also accepts
  `output_indexes` when `variants` is omitted. Returns `play_session_id`,
  `tracks`, and `first_track.variants[].url` plus waveform `levels`. Pass the
  session ID to the ADN Player; use signed URLs only with a custom player.
  `scope` is `collection` or `track` (playlist is unsupported). Fetch additional
  tracks with `GET /v1/play/{play_session_id}/{play_track_id}` (no Bearer).
  (MCP tools: `adn_create_play_session`, `adn_get_play_session`,
  `adn_get_play_track`.)
- **Downloads**: when the session was created with `is_downloadable: true`
  (and the API key allows downloads),
  `GET /v1/play/{play_session_id}/{play_track_id}/{variant_index}/download`
  returns a short-lived signed download URL (`adn_get_play_download`). The path
  segment is an output index (`variant_index` is the historical name).
- **Signed delivery**: sign a delivery URL on your server with a URL Signing key
  (HMAC-SHA256; the `verify` query param must be appended **last**). Skips play
  sessions for public/entitled tracks. The signing secret is server-only. Build
  the URL from the durable `track.base_url` returned at track creation, plus the
  index suffix and extension (e.g. `{base_url}_lq.mp3`).
- **Inline share**: mint a share key with `POST /v1/api_key`
  (`adn_create_client_key`, `api_key_type_id: "share"`, exactly one output index
  in `variants`), then use `GET /v1/stream/{track_id}/{share_key}` which redirects
  (302) to a signed CDN URL. No Bearer header. Do not fetch this redirect from
  the MCP server — hand the URL to a browser or player.

For components, pass a Client-Side Player key **or** a server-provisioned play
session ID to `<audiodn-player>` — never both, and never a signed URL. Never
expose the API Access key to the client.

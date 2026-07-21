# Upload flow (do not skip steps)

The upload lifecycle is multi-step. Creating a session alone uploads nothing.

1. **Create an upload session** (server, Bearer):
   `POST /v1/upload_session` -> returns `upload_session_id`. A session can hold
   many tracks and does **not** return an upload URL by itself.
   (MCP tool: `adn_create_upload_session`.)
2. **Create a track in the session** (no Bearer — the session ID authorizes it):
   `POST /v1/upload/{upload_session_id}/track` -> returns `track_id`, the full
   `track` object (including the durable delivery prefix `track.base_path` /
   `track.base_url`), and a per-track upload target in `track_upload.upload_url`
   (with `track_upload.method`, which is `PUT`). A cover image target is returned
   in `track_cover_upload`. Do this **once per file**.
   (MCP tool: `adn_create_track_in_upload_session`.)
3. **Upload the bytes**: `PUT` the file to `track_upload.upload_url`. This is done
   by your own code/client, not the API — the MCP server returns the URL for you.
4. **Wait for readiness** before playback (see the processing guide).

The per-track upload URL is short-lived and single-purpose. Never store it in a
database, cache it, or treat it as a permanent link — mint a fresh track if it
expires. `track.base_path` / `track.base_url` ARE durable — store them (with
`track_id`) if you use signed delivery. Each variant file is that prefix plus a
variant suffix and extension (e.g. `{base_url}_128.mp3`); `base_url` lives on
the organization's unique `audiodelivery.net` subdomain. Never upload to it.

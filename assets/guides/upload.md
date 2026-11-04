# Upload flow (do not skip steps)

The upload lifecycle is multi-step. Creating a session or track alone uploads
nothing. Distinguish these stages:

1. **Track resource created** — a `track` row exists (`initialized`).
2. **Upload URL issued** — `track_upload.upload_url` is returned (`stage:
   upload_url_issued` from MCP create tools).
3. **Audio bytes uploaded** — your client `PUT`s the file to that URL.
4. **Upload accepted** — AudioDN sees the R2 object; status moves past
   `initialized` and `size` is set (`upload_accepted` in
   `adn_get_processing`).
5. **Processing started / completed** — see the processing guide.

## Session flow

1. **Create an upload session** (server, Bearer):
   `POST /v1/upload_session` -> returns `upload_session_id`. A session can hold
   many tracks and does **not** return an upload URL by itself unless you also
   pass a nested `track` object with `file_name`. Optional `expires_in` is
   60–86400 seconds (default 3600). Pass `Idempotency-Key` (MCP:
   `idempotency_key`) when retrying after a lost response.
   (MCP tool: `adn_create_upload_session`.)
2. **Create a track in the session**:
   `POST /v1/upload/{upload_session_id}/track` -> returns `track_id`, the full
   `track` object (including durable `track.base_path` / `track.base_url`), and
   `track_upload.upload_url` (`PUT`). A cover image target is returned in
   `track_cover_upload`. Do this **once per file**.
   (MCP tool: `adn_create_track_in_upload_session`.)
3. **Upload the bytes**: `PUT` the file to `track_upload.upload_url`. This is
   done by your own code/client, not the MCP server. The MCP cannot access local
   files or remote URLs for you.
4. **Wait for readiness** with `adn_wait_for_processing` (see the processing
   guide). Creating the track is not success for "upload this song."

One-shot alternative: `POST /v1/track` / `adn_create_track` also returns an
upload URL with the same stages.

Cover upload URLs expire. Re-mint with `POST /v1/collection/{id}/cover` or
`POST /v1/track/{id}/cover`. Persist the returned `cloudflare_image_id` and wait
with `adn_wait_for_processing` target `cover` — never treat an older palette as
the result of a newer image.

The per-track upload URL is short-lived. Never store it. `track.base_path` /
`track.base_url` ARE durable. Each output file is that prefix plus an index
suffix and extension. Never upload to `base_url`.

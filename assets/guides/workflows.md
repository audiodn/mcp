# Agent workflows

Task-oriented patterns. Use knowledge tools (`adn_get_guide`, `adn_search_docs`)
when unsure. Prefer IDs returned from find/create for later steps.

## 1. Create collection and upload one track

1. `adn_find_resource` type=collection name=…
2. If not found, `adn_create_collection` (optional `idempotency_key`)
3. `adn_create_track` with `collection_id` and `file_name`
4. Client PUTs bytes to `track_upload.upload_url`
5. `adn_wait_for_processing` target=`track_playback`

## 2. Upload multiple tracks in a batch

1. Resolve or create the collection once
2. `adn_create_upload_session`
3. For each file: `adn_create_track_in_upload_session`, PUT bytes, keep track_ids
4. Wait per track or settle as needed
5. On interruption, resume with existing track_ids — do not recreate successes

## 3. Resolve an unspecified collection

1. Ask the user if the name is missing (`COLLECTION_REQUIRED`)
2. `adn_find_resource` — exact match → use id; ambiguous → show candidates;
   missing → ask before creating

## 4. Associate a creator

1. `adn_find_resource` type=creator
2. Pass `creator_id` on create/update
3. Pass `creator_id: null` on update to clear

## 5. Upload and wait for a waveform image

1. Confirm a waveform output index exists via `adn_list_output_presets` /
   `adn_get_processing` (dashboard-configured; not API-creatable)
2. Upload audio
3. `adn_wait_for_processing` target=`track_output` output_index=`…`
4. If `OUTPUT_NOT_CONFIGURED`, stop — do not poll forever

## 6. Upload cover and wait for colours

1. `adn_create_collection_cover` or `adn_create_track_cover`
2. Persist `cloudflare_image_id`; client POSTs image bytes
3. `adn_wait_for_processing` target=`cover` with that image id
4. If `COVER_SUPERSEDED`, a newer cover won the race

## 7. Generate a track-specific transcode

1. `adn_list_output_presets` to avoid index collisions
2. `adn_create_track_output` with `output_type_id` transcode or preview
3. `adn_wait_for_processing` target=`track_output`

## 8. Retrieve a playable track

1. Wait `track_playback`
2. `adn_create_play_session` with non-empty `variants` (output indexes)
3. Pass `play_session_id` to the ADN Player, or fetch signed URLs for a custom player

## 9. Recover from partial processing failure

1. `adn_get_processing` — inspect per-output `state` / `status_text`
2. Playable + failed optional output → return the playable link and report the failure
3. Required failure (`incomplete`) → report both playability and the failed index

## 10. Resume after an interrupted wait

1. Keep `track_id` / `output_index` / `cloudflare_image_id`
2. Call `adn_wait_for_processing` again with the same arguments
3. Clients are not guaranteed to auto-resume after `pending`

## 11. Safely delete a collection

1. Resolve the collection unambiguously
2. `adn_delete_collection` with `dry_run: true`
3. Confirm with the user, then call without `dry_run`

## 12. Unsupported operations

If the API cannot do something (e.g. LUFS normalization, remote URL fetch, or
creating a dashboard-only waveform via API), say so and offer the closest
supported alternative from the guides.

## Manual staging checklist (live audio)

Automated tests use fixtures only. On a staging org, verify once by hand:

1. Create a track (note `stage: upload_url_issued`) and PUT a real audio file
2. Poll `adn_get_processing` until `upload_accepted` is true
3. `adn_wait_for_processing` target=`track_playback` → playable success
4. If a waveform preset exists, wait `track_output` for that index (or confirm it stays optional while playback succeeds)
5. Retry a create with the same `idempotency_key` and confirm no second row
6. Cover wait for image B after uploading A then B → B’s colours; wait for A → `COVER_SUPERSEDED`

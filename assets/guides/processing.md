# Processing and readiness

After audio bytes are uploaded, AudioDN processes the track: probing, waveforms,
output-preset transcodes/previews, optional fallback processing, and cover
extraction. Creating a track only issues an upload URL — it does not mean the
bytes arrived or that processing started.

## Status values

Transitional:

- `initialized` — track row exists; bytes not accepted yet
- `processing` — upload accepted; workers running
- `fallback` / `fallback_processing` — large or long files on the fallback path

Terminal:

- `ready` — required outputs succeeded and a playable (`transcode` or `original`)
  file exists. Optional outputs may still be pending or may have failed.
- `incomplete` — a playable file exists, but a required output failed. Still
  playable for streaming when a successful playable file is present.
- `error` / `init_error` — not playable

## How agents should wait

Prefer MCP tools:

- `adn_get_processing` — uncached snapshot with per-output state
- `adn_wait_for_processing` — bounded poll (default 12s, max 15s)

Targets:

- `track_playback` — wait until playable (`ready` or `incomplete` with a
  successful playable file). Does not wait for waveform or other optional files.
- `track_output` — wait for a specific `output_index`. Returns
  `OUTPUT_NOT_CONFIGURED` immediately if that index is not expected.
- `track_settled` — wait until `files_completed_at` is set, then report
  per-output success and failure (`partial_success` when some failed).
- `cover` — wait for colour analysis of a specific `cloudflare_image_id`

When the wait budget expires, the tool returns `status: pending` with the same
ids and a `retry_after_seconds` hint. Processing continues on the server. Call
wait again to resume. Clients are not guaranteed to poll automatically.

Pending codes:

- `UPLOAD_NOT_ACCEPTED` — the track row exists but bytes have not arrived.
  Returned immediately. PUT the file, then wait again. This is not a transcode delay.
- `OUTPUT_PROCESSING` — the requested `output_index` is in flight. Same
  `track_id` and `output_index` resume the wait. Playback can still succeed
  while an optional output (waveform) stays pending.
- `PROCESSING_TIMEOUT` — the budget ended and the snapshot is not terminal yet.

## Webhooks

Production apps can also react to Track Processing webhooks
(`track.status_changed`, `track_file.created`, `track_file.failed`). MCP agents
should not rely on registering webhooks through these tools.

See also `output-types` / `adn_list_output_presets` for delivery indexes, and
`workflows` for end-to-end examples.

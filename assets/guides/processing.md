# Processing and readiness

After the bytes are uploaded, AudioDN processes the track: probing, waveform
generation, variant transcodes/previews, optional fallback processing, and cover
extraction. A track is not playable the instant it uploads.

Every variant file lands under the track's durable delivery prefix —
`track.base_path` / `track.base_url` from the track-creation response — plus a
variant suffix and extension (e.g. `{base_url}_preview.mp3`).

Determine readiness in one of two ways:

- **Poll**: `GET /v1/track/{track_id}` (server, Bearer) until
  `track.track_status_id === 'ready'`. (MCP tool: `adn_get_track`.)
- **Webhook** (preferred in production): react to the Track Processing webhook,
  which fires on terminal outcomes / when the file set is complete — not on every
  transitional status.

Status values:

- Transitional: `initialized`, `processing`, `fallback`, `fallback_processing`.
- Terminal: `ready`, `incomplete`, `error`, `init_error`.

Never build a playback experience that assumes a just-uploaded track is ready.
Only `ready` is safe to play; the other terminal states indicate a problem.

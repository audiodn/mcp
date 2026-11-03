# Output types

An **output preset** (previously called a variant) is a reusable configuration
that defines what AudioDN generates from an upload. An **output** is the result
of applying a preset to a track (a stored file and/or related data).

AudioDN supports seven output types:

1. **Transcoded Version** (`transcode`) — codec / bitrate / channel / metadata
   settings. Delivery `index` values like `hq` and `lq` are transcode outputs.
2. **Preview Clip** (`preview`) — a clipped preview with its own transcode options.
3. **Audio Analysis** (`levels`) — waveform sample metrics. A default 320-sample
   waveform is generated for free.
4. **Waveform Video** (`waveform_video`) — an animated MP4 with optional embedded
   audio.
5. **Waveform Image** (`waveform_image`) — a static PNG waveform.
6. **Original Upload** (`original`) — the preserved source file.
7. **Cover Image** (`cover`) — embedded cover extraction plus color palette /
   `player_color` theming.

Two related concepts:

- **`output_type_id`** (legacy: `variant_type_id`) — the recipe type (one of the
  seven above).
- **delivery / output `index`** — the per-organization name used in play sessions
  and signed URLs (e.g. `hq`, `lq`, `preview`, `waveform`). This is org-configured,
  not a global enum. Use `adn_list_output_presets` (GET `/v1/output_preset`) to
  see presets on your organization.

API surface note: only `transcode` and `preview` can be created through the REST
API (`POST /v1/track/{track_id}/output`; legacy alias
`POST /v1/track/{track_id}/variant`). The other types are produced automatically
during processing or configured in the dashboard.

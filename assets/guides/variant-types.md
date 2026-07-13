# Variant types

A variant is a processed derivative of an uploaded track. AudioDN supports seven
variant types:

1. **Transcoded Version** (`transcode`) — codec / bitrate / channel / metadata
   settings. Delivery `index` values like `hq` and `lq` are transcode variants.
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

- **`variant_type_id`** — the recipe type (one of the seven above).
- **delivery `index`** — the per-organization name used in play sessions and
  signed URLs (e.g. `hq`, `lq`, `preview`, `waveform`). This is org-configured,
  not a global enum. Use `adn_list_variants` to see the variants configured on
  your organization.

API surface note: only `transcode` and `preview` variant types can be created
through the REST API (`POST /v1/track/{track_id}/variant`). The other types are
produced automatically during processing or configured in the dashboard.

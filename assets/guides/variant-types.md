# Output types (legacy guide slug: variant-types)

Prefer the `output-types` guide topic. Output presets were previously called
variants; the type catalog is the same.

An **output preset** is a reusable configuration that defines what AudioDN
generates from an upload. AudioDN supports seven output types:

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

- **`output_type_id`** (legacy: `variant_type_id`) — the recipe type.
- **delivery / output `index`** — org-configured name used in play sessions and
  signed URLs. Use `adn_list_output_presets` (GET `/v1/output_preset`).

Only `transcode` and `preview` are API-creatable via
`POST /v1/track/{track_id}/output` (legacy: `.../variant`).

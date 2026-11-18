# Web components

Package: `@audiodn/components` on unpkg / jsDelivr
(`…/@audiodn/components@latest/dist/{player,uploader,recorder,waveform}.js`).

Compose a paste-ready player with **`adn_build_player_embed`** (offline). Typical
flow: resolve the resource (`adn_find_resource`), mint a scoped Client-Side
**Player** key (`adn_create_client_key`, `api_key_type_id: "player"`), then call
the embed tool. Never put a server API Access key in browser markup.

Every component takes **exactly one** credential — never both, and never an API
Access key:

- **`api-key`** — scoped Client-Side Player / Uploader key. Long-lived (or
  `expires_at`-bounded); the component creates its own sessions.
- **`play-session-id` / `upload-session-id`** — server-minted with an API Access
  key; short-lived; the client holds no key.

## `<audiodn-player>`

- `api-key` **or** `play-session-id`
- `scope` — `track` | `collection`; `id` matching that scope
- `variants` — comma-separated delivery indexes in priority order (e.g.
  `hq,lq`). The published package reads this attribute (including `@latest`).
- `outputs` — same list on a future release; current package ignores it, so do
  not replace `variants` on existing embeds yet.
- `size` — `x-small` | `small` | `regular` (default `regular`; default layout)
- `variant` — layout: `default` (full player) | `inline` (compact play/pause +
  progress ring; no track info — surface that yourself). `height` sizes inline.
- `theme` — `auto` | `dark` | `light`
- `volume`, `autoplay`, `downloadable` (request only; key/session must allow)
- Waveform-related attrs are forwarded to the waveform child

Theming uses `--adn-*` CSS custom properties (and a host `class` for full
restyling). Canonical docs:
https://audiodeliverynetwork.com/docs/components/player

CDN drop-in:

```html
<script type="module" src="https://unpkg.com/@audiodn/components@latest/dist/player.js"></script>
<audiodn-player
  api-key="PLAYER_KEY"
  scope="collection"
  id="COLLECTION_ID"
  variants="hq,lq"
></audiodn-player>
```

## `<audiodn-uploader>` / `<audiodn-recorder>`

- `api-key` **or** `upload-session-id`; optional `collection-id` when the
  key/session is not already collection-scoped
- Uploader: multi-file; `file-uploaded` means bytes stored, **not** ready
- Recorder: single in-browser capture; same readiness caveat after upload

## `<audiodn-waveform>`

- JS property `levels`; `variant` `vertical` | `wavy` | `reflection`
- `height`, `line-width`, `line-color`, `gap`, `scale-strength`, `progress`,
  `duration`

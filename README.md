# `@audiodn/mcp`

Model Context Protocol server for AudioDN.

Exposes the AudioDN REST API as MCP tools so AI agents (Cursor, Claude Desktop,
Claude Code, VS Code, Codex, etc.) can configure audio hosting on a user's
behalf, plus offline, read-only **knowledge tools** grounded in the canonical
AudioDN OpenAPI spec and documentation so agents look up the correct endpoints
instead of guessing.

## Install in Cursor

One-click install (hosted endpoint — sign in with your AudioDN account via
OAuth when the client connects):

[![Add AudioDN to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=audiodn&config=eyJ1cmwiOiJodHRwczovL21jcC5hdWRpb2RlbGl2ZXJ5Lm5ldC9tY3AifQ==)

Prefer a local stdio server with an API Access key? Use this button instead:

[![Add AudioDN (npx) to Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](cursor://anysphere.cursor-deeplink/mcp/install?name=audiodn&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBhdWRpb2RuL21jcCJdLCJlbnYiOnsiQUROX0FQSV9LRVkiOiJhZG5fWU9VUl9BUElfS0VZIn19)

Both correspond to the [`mcp.json`](mcp.json) shipped with this plugin. See
[Cursor's MCP docs](https://cursor.com/docs/context/mcp) for manual setup.

## Install

```bash
npm install -g @audiodn/mcp
# or run on demand
npx @audiodn/mcp
```

## Configure

### Hosted (recommended for account login)

Point a remote-capable MCP client at `https://mcp.audiodelivery.net/mcp` with
**no** Authorization header. The client runs the MCP OAuth flow: you sign in at
`account.audiodeliverynetwork.com`, pick an organization, and Allow. That mints
a revocable API Access key (visible under Settings → API Keys as `MCP · …`).
Delete that key to disconnect.

Legacy configs that still send `Authorization: Bearer <API Access key>` or
`X-ADN-API-Key` continue to work.

### Local stdio

Knowledge/doc tools work with **no key**. For live API tools, set a server-side
AudioDN API Access key (mint one in the dashboard at
<https://account.audiodeliverynetwork.com> under Settings → API Keys).

```bash
export ADN_API_KEY="adn_..."
# Optional overrides:
# export ADN_API_BASE_URL="https://api.audiodelivery.net"  # default
# export ADN_MCP_LIVE_DOCS=1        # refresh bundled docs from the public site at startup
# export ADN_MCP_TIMEOUT_MS=30000   # per-request timeout
```

### Environment variables (stdio)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ADN_API_KEY` | No | – | Server-side API Access key for live-API tools. Knowledge tools work without it. |
| `ADN_API_BASE_URL` | No | `https://api.audiodelivery.net` | Override the API host. |
| `ADN_MCP_LIVE_DOCS` | No | off | Set to `1` to refresh bundled docs from the public site (falls back to the bundle offline). |
| `ADN_MCP_TIMEOUT_MS` | No | `30000` | Per-request timeout in milliseconds. |

## Safety model

- Reads and knowledge tools are annotated read-only.
- Create/update tools are annotated so MCP clients can prompt for approval; the
  client is the human-in-the-loop layer.
- Delete tools (`adn_delete_creator`, `adn_delete_collection`, `adn_delete_track`)
  are available whenever live API tools are authenticated. They set
  `destructiveHint: true` so clients should confirm before running them.

## Hosted (remote) endpoint

Besides the local `npx` stdio server above, AudioDN runs the same tool set as a
**hosted Streamable HTTP endpoint** on Cloudflare Workers.

- **URL:** `https://mcp.audiodelivery.net/mcp` — the MCP endpoint. The root
  `/` serves a human landing page in a browser (and JSON for tooling), and
  `/health` returns machine-readable server info.
- **Auth — OAuth account login:** compatible clients discover
  `/.well-known/oauth-protected-resource` and complete authorization code + PKCE
  against this host. Unauthenticated `/mcp` requests return `401` with a
  `WWW-Authenticate` challenge. Knowledge and live tools (including deletes)
  require authentication on the hosted endpoint.
- **Auth — legacy API key:** send your AudioDN API Access key on every request:

```
Authorization: Bearer adn_...
# or
X-ADN-API-Key: adn_...
```

Example client configuration (OAuth — no pasted key):

```json
{
  "mcpServers": {
    "audiodn": {
      "url": "https://mcp.audiodelivery.net/mcp"
    }
  }
}
```

The hosted Worker lives in `worker/` and is deployed with Wrangler
(`npm run deploy`); it is not part of the published npm package.

Worker secrets (not committed): `MCP_JWT_SECRET`, `MCP_GRANT_ENCRYPTION_KEY`,
`MCP_INTERNAL_HMAC`, plus a KV namespace bound as `MCP_OAUTH`.

## Use with Cursor

Settings → Tools & Integrations → MCP (or edit `~/.cursor/mcp.json`):

Hosted (OAuth):

```json
{
  "mcpServers": {
    "audiodn": {
      "url": "https://mcp.audiodelivery.net/mcp"
    }
  }
}
```

Local stdio:

```json
{
  "mcpServers": {
    "audiodn": {
      "command": "npx",
      "args": ["-y", "@audiodn/mcp"],
      "env": { "ADN_API_KEY": "adn_..." }
    }
  }
}
```

## Use with Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
(or the equivalent on your OS), then restart the app:

```json
{
  "mcpServers": {
    "audiodn": {
      "command": "npx",
      "args": ["-y", "@audiodn/mcp"],
      "env": { "ADN_API_KEY": "adn_..." }
    }
  }
}
```

## Use with Claude Code

```bash
claude mcp add audiodn --env ADN_API_KEY=adn_... -- npx -y @audiodn/mcp
```

## Use with VS Code (Copilot) / Codex / Windsurf

Any client that speaks MCP over stdio uses the same command. For VS Code, add to
`.vscode/mcp.json`:

```json
{
  "servers": {
    "audiodn": {
      "command": "npx",
      "args": ["-y", "@audiodn/mcp"],
      "env": { "ADN_API_KEY": "adn_..." }
    }
  }
}
```

For Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.audiodn]
command = "npx"
args = ["-y", "@audiodn/mcp"]
env = { ADN_API_KEY = "adn_..." }
```

## Tools

### Knowledge tools (read-only, offline)

| Tool | Description |
| --- | --- |
| `adn_about` | Server version, bundled OpenAPI version, docs source, API base. |
| `adn_search_docs` | Keyword search over bundled docs + OpenAPI summaries. |
| `adn_list_operations` | List all REST operations (operationId, method, path). |
| `adn_get_operation` | Full OpenAPI definition for one operationId. |
| `adn_get_guide` | Canonical guide (authentication, upload, processing, playback, webhooks, output-types / variant-types, security, compatibility). |
| `adn_list_output_types` | The seven output types and which are API-creatable (`adn_list_variant_types` is a legacy alias). |

On the **hosted** endpoint these require authentication (OAuth or legacy API
key). On **stdio** they work without `ADN_API_KEY`.

### Live API tools

| Tool | Description | Annotation |
| --- | --- | --- |
| `adn_get_organization` / `adn_update_organization` | Read/update org (id derived from API key when omitted) | read-only / write |
| `adn_create_client_key` | Mint player / uploader / share key (returned once) | write |
| `adn_list_creators` / `adn_get_creator` | Read creators | read-only |
| `adn_create_creator` / `adn_update_creator` | Create/update creator | write |
| `adn_delete_creator` | Delete creator | destructive |
| `adn_list_collections` / `adn_get_collection` | Read collections | read-only |
| `adn_create_collection` / `adn_update_collection` | Create/update collection | write |
| `adn_delete_collection` | Delete collection + its tracks | destructive |
| `adn_create_collection_cover` | Mint a fresh collection cover upload URL | write |
| `adn_list_tracks` / `adn_get_track` | Read tracks. `adn_get_track` is metadata; use processing tools for readiness | read-only |
| `adn_find_resource` | Exact name lookup for collection, creator, or track. Ambiguous names return candidates and do not create | read-only |
| `adn_get_processing` | Uncached snapshot: `upload_accepted`, `playable`, per-output state | read-only |
| `adn_wait_for_processing` | Short wait (default 12s) for playback, one output, settle, or cover. `pending` means call again with the same ids | read-only |
| `adn_create_track` | One-shot track create (`POST /v1/track`) with upload URL | write |
| `adn_update_track` | Update track metadata / player fields | write |
| `adn_delete_track` | Soft-delete one track | destructive |
| `adn_create_track_cover` | Mint a fresh track cover upload URL | write |
| `adn_create_upload_session` / `adn_get_upload_session` | Manage upload sessions (optional nested `track`) | write / read-only |
| `adn_create_track_in_upload_session` | Register a track, get `track_upload.upload_url` | write |
| `adn_create_play_session` / `adn_get_play_session` | Mint/read play sessions (output indexes via `variants` wire field) | write / read-only |
| `adn_get_play_track` | Signed URLs for a track inside a play session | read-only |
| `adn_get_play_download` | Signed download URL for one output index (downloadable sessions) | read-only |
| `adn_list_output_presets` / `adn_get_output_preset` | List/get org output presets (legacy: `adn_list_variants` / `adn_get_variant`) | read-only |
| `adn_create_track_output` | Add a track-specific transcode/preview output (legacy: `adn_create_track_variant`) | write |

## Resources

The server also exposes canonical docs as MCP resources for clients that attach
context directly: `audiodn://openapi.json`, `audiodn://llms-full.txt`, and
`audiodn://guide/{topic}` for each guide.

## Example flow

An agent helping a user host a podcast might call:

1. `adn_get_guide({ topic: "upload" })` — learn the canonical multi-step flow.
2. `adn_create_collection({ title: "My Podcast" })`
3. `adn_create_upload_session({ collection_id })` — or pass nested
   `track: { file_name }` to create the first track in the same call.
4. `adn_create_track_in_upload_session({ upload_session_id, file_name: "ep1.mp3" })`
   (skip if you already nested `track` above).
5. Your code `PUT`s the audio bytes to `track_upload.upload_url`. Create does not upload.
6. `adn_wait_for_processing({ target: "track_playback", track_id })`.
   `pending` with `UPLOAD_NOT_ACCEPTED` means the PUT has not landed.
   `pending` with `OUTPUT_PROCESSING` or `PROCESSING_TIMEOUT` means workers are
   still running — call the same tool again with the same ids. `incomplete` can
   still be playable. To wait for one file (waveform, preview), use
   `target: "track_output"` and `output_index`.
7. `adn_list_output_presets()` — pick real output indexes (e.g. `hq`, `lq`).
8. `adn_create_play_session({ scope: "track", track_id, variants: ["hq"] })` —
   returns a `play_session_id` (for the ADN Player) plus signed file URLs on
   `first_track` (for a custom player).

## Build from source

```bash
npm install
npm run build
npm test           # vitest
npm run smoke      # build + spawn the real binary over stdio
node dist/index.js
```

## Local development (API + MCP)

Run the AudioDN API and this MCP worker on different ports, then exercise OAuth
and tools with the manual scripts under [`manual/`](manual/):

```bash
# Terminal 1 — AudioDN API (audiodn-mono)
npm run dev:api                 # http://127.0.0.1:8787

# Terminal 2 — MCP worker (this repo)
cp .dev.vars.example .dev.vars  # set ADN_API_KEY to a dashboard API Access key
npm run dev:local               # http://127.0.0.1:8788  (ADN_API_BASE_URL → local API)

npm run manual:auth             # browser consent → writes manual/.env
npm run manual                  # find, create, processing-wait, dry-run, delete
```

`ADN_API_BASE_URL` in `.dev.vars` (or the stdio environment) is the switch for
which AudioDN API the MCP server calls. Production `wrangler.toml` keeps the
public API default.

## Deploy the hosted endpoint

The Cloudflare Worker in `worker/` serves the same tools over Streamable HTTP.

```bash
npx wrangler login
# Create KV + secrets once:
#   wrangler kv namespace create MCP_OAUTH
#   wrangler secret put MCP_JWT_SECRET
#   wrangler secret put MCP_GRANT_ENCRYPTION_KEY
#   wrangler secret put MCP_INTERNAL_HMAC
npm run dev:worker        # default wrangler port (avoid colliding with local API)
npm run dev:local         # port 8788 + .dev.vars for local API/OAuth
npm run deploy            # publish -> https://mcp.audiodelivery.net (custom domain)
curl https://mcp.audiodelivery.net/health
```

The custom domain `mcp.audiodelivery.net` is provisioned by Cloudflare from the
`routes` entry in `wrangler.toml` (the `audiodelivery.net` zone must be on the
same Cloudflare account).

To list on the official MCP registry (registry name `net.audiodelivery/mcp`,
which must match `mcpName` in `package.json`): verify the domain once with
`mcp-publisher login dns --domain audiodelivery.net` (add the printed TXT
record), confirm `remotes[0].url` in `server.json` points at the deployed URL,
then `mcp-publisher publish`.

## Keeping docs fresh

Bundled snapshots live in `assets/snapshots/`. Refresh them from the public site
with `npm run sync`; `prepublishOnly` verifies they are consistent before a
release.

## Reference

- MCP docs: <https://audiodeliverynetwork.com/docs/mcp>
- API docs: <https://audiodeliverynetwork.com/docs/api>
- OpenAPI spec: <https://audiodeliverynetwork.com/openapi.json>
- For-AI-agents guide: <https://audiodeliverynetwork.com/for-ai-agents>

# `@audiodn/mcp`

Model Context Protocol server for AudioDN.

Exposes the AudioDN REST API as MCP tools so AI agents (Cursor, Claude Desktop,
Claude Code, VS Code, Codex, etc.) can configure audio hosting on a user's
behalf, plus offline, read-only **knowledge tools** grounded in the canonical
AudioDN OpenAPI spec and documentation so agents look up the correct endpoints
instead of guessing.

## Install

```bash
npm install -g @audiodn/mcp
# or run on demand
npx @audiodn/mcp
```

## Configure

Set a server-side AudioDN API key (mint one in the dashboard at
<https://account.audiodeliverynetwork.com> under Settings → API Keys).

```bash
export ADN_API_KEY="adn_..."
# Optional overrides:
# export ADN_API_BASE_URL="https://api.audiodelivery.net"  # default
# export ADN_MCP_ALLOW_DELETE=1     # enable destructive delete tools (off by default)
# export ADN_MCP_LIVE_DOCS=1        # refresh bundled docs from the public site at startup
# export ADN_MCP_TIMEOUT_MS=30000   # per-request timeout
```

### Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ADN_API_KEY` | Yes | – | Server-side, full-access API key used for all live-API tools. |
| `ADN_API_BASE_URL` | No | `https://api.audiodelivery.net` | Override the API host. |
| `ADN_MCP_ALLOW_DELETE` | No | off | Set to `1` to expose the destructive `adn_delete_*` tools. |
| `ADN_MCP_LIVE_DOCS` | No | off | Set to `1` to refresh bundled docs from the public site (falls back to the bundle offline). |
| `ADN_MCP_TIMEOUT_MS` | No | `30000` | Per-request timeout in milliseconds. |

## Safety model

- Reads and knowledge tools are annotated read-only and always available.
- Create/update tools run with the API key but are annotated so MCP clients can
  prompt for approval; the client is the human-in-the-loop layer.
- The two **delete** tools (`adn_delete_creator`, `adn_delete_collection`) are
  hidden and refuse to run unless the server is started with
  `ADN_MCP_ALLOW_DELETE=1`. Set it once to opt in.

## Use with Cursor

Settings → Tools & Integrations → MCP (or edit `~/.cursor/mcp.json`):

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

### Knowledge tools (read-only, offline, no API key needed)

| Tool | Description |
| --- | --- |
| `adn_about` | Server version, bundled OpenAPI version, docs source, API base. |
| `adn_search_docs` | Keyword search over bundled docs + OpenAPI summaries. |
| `adn_list_operations` | List all REST operations (operationId, method, path). |
| `adn_get_operation` | Full OpenAPI definition for one operationId. |
| `adn_get_guide` | Canonical guide (authentication, upload, processing, playback, webhooks, variant-types, security, compatibility). |
| `adn_list_variant_types` | The seven variant types and which are API-creatable. |

### Live API tools

| Tool | Description | Annotation |
| --- | --- | --- |
| `adn_list_creators` / `adn_get_creator` | Read creators | read-only |
| `adn_create_creator` / `adn_update_creator` | Create/update creator | write |
| `adn_delete_creator` | Delete creator | destructive (gated) |
| `adn_list_collections` / `adn_get_collection` | Read collections | read-only |
| `adn_create_collection` / `adn_update_collection` | Create/update collection | write |
| `adn_delete_collection` | Delete collection + its tracks | destructive (gated) |
| `adn_list_tracks` / `adn_get_track` | Read tracks; `adn_get_track` polls readiness | read-only |
| `adn_create_upload_session` / `adn_get_upload_session` | Manage upload sessions | write / read-only |
| `adn_create_track_in_upload_session` | Register a track, get `track_upload.upload_url` | write |
| `adn_create_play_session` / `adn_get_play_session` | Mint/read play sessions (scope: collection, track) | write / read-only |
| `adn_list_variants` | List org delivery variants | read-only |

## Resources

The server also exposes canonical docs as MCP resources for clients that attach
context directly: `audiodn://openapi.json`, `audiodn://llms-full.txt`, and
`audiodn://guide/{topic}` for each guide.

## Example flow

An agent helping a user host a podcast might call:

1. `adn_get_guide({ topic: "upload" })` — learn the canonical multi-step flow.
2. `adn_create_collection({ title: "My Podcast" })`
3. `adn_create_upload_session({ collection_id })`
4. `adn_create_track_in_upload_session({ upload_session_id, file_name: "ep1.mp3" })`
5. Your code `PUT`s the audio bytes to `track_upload.upload_url`.
6. Poll `adn_get_track({ track_id })` until `track_status_id === "ready"`.
7. `adn_create_play_session({ scope: "track", track_id })` — returns a signed
   playback URL that can be embedded directly.

## Build from source

```bash
npm install
npm run build
npm test           # vitest
npm run smoke      # build + spawn the real binary over stdio
node dist/index.js
```

## Keeping docs fresh

Bundled snapshots live in `assets/snapshots/`. Refresh them from the public site
with `npm run sync`; `prepublishOnly` verifies they are consistent before a
release.

## Reference

- API docs: <https://audiodeliverynetwork.com/docs/api>
- OpenAPI spec: <https://audiodeliverynetwork.com/openapi.json>
- For-AI-agents guide: <https://audiodeliverynetwork.com/for-ai-agents>

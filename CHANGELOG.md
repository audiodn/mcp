# Changelog

## 0.5.0

- Canonical output-preset tools: `adn_list_output_presets`, `adn_get_output_preset`,
  `adn_create_track_output`, and `adn_list_output_types`. Legacy names
  (`adn_list_variants`, `adn_get_variant`, `adn_create_track_variant`,
  `adn_list_variant_types`) remain as one-line aliases sharing the same handlers.
- Client calls canonical paths `GET /v1/output_preset`,
  `GET /v1/output_preset/:id`, and `POST /v1/track/:track_id/output`.
- Play-session tool descriptions talk about output indexes while documenting the
  historical `variants` body field still used on the wire.
- Guides: added `output-types`; updated processing/playback/upload/webhooks/
  authentication terminology.

## 0.4.0

- Hosted MCP uses OAuth 2.1 (authorization code + PKCE) against the AudioDN
  account: protected-resource / authorization-server metadata, consent at
  `/connect/mcp`, encrypted API Access grants in KV, audience-bound JWTs.
  Legacy API Access Bearer / `X-ADN-API-Key` still works. Unauthenticated
  hosted `/mcp` returns `401` with `WWW-Authenticate` (no anonymous tools).
- Destructive delete tools are always available when authenticated
  (`destructiveHint: true`); removed `ADN_MCP_ALLOW_DELETE` /
  `X-ADN-Allow-Delete`.
- Added `adn_create_track` for `POST /v1/track`.
- Install configs and docs prefer the bare hosted URL (OAuth) over pasting a key.

## 0.3.6

- Stdio starts without `ADN_API_KEY` (knowledge tools only); hosted ignores empty
  / uninterpolated `${env:ADN_API_KEY}` placeholders.
- Shared server instructions + MCP resources on both stdio and the hosted Worker.
- Schema parity: upload session `expires_in` + nested `track`, track player
  fields on session track create, collection cover/theme override flags,
  play-session scope/id validation, empty-update rejection, JSON Schema
  `minItems` for `variants`.
- New tools: `adn_get_organization`, `adn_update_organization`,
  `adn_create_client_key`, `adn_create_collection_cover`, `adn_create_track_cover`,
  `adn_get_variant`, `adn_get_play_download`.
- Hosted delete opt-in via `X-ADN-Allow-Delete: 1` (stdio still uses
  `ADN_MCP_ALLOW_DELETE=1`). Caller API key redacted from error messages.
- Offline contract test maps every bundled OpenAPI `operationId` to a tool or an
  explicit omission. Registry package version aligned; `ADN_API_KEY` marked
  optional in `server.json`.

## 0.3.5

- Refreshed bundled OpenAPI snapshot: `track.track_status_id` (eight real
  statuses), variant rows as `index` / `variant_type_id` / `props`, list
  `limit` max 100, and `GET /v1/stream/{track_id}/{api_key}`.
- `adn_create_play_session` now requires a non-empty `variants` list; README
  example lists variants first.
- Added `adn_update_track`, gated `adn_delete_track`, `adn_create_track_variant`,
  and `adn_get_play_track`.
- Dropped "normalize" wording from `server.json`; expanded authentication guide
  for client-side keys, share keys, and URL Signing.

## 0.3.4

- Explicitly set `destructiveHint: false` on non-destructive MCP tool annotation
  presets (`READ_ONLY`, `WRITE`, `WRITE_IDEMPOTENT`, `LOCAL_READ_ONLY`) so OpenAI
  and other hosts that require a declared destructive flag accept write tools.
- Clarified upload/play guides around per-track upload URL creation (session
  create does not return the final upload URL; each track needs its own
  track-creation request).
- Bumped Cursor plugin manifest version to match the package.

## 0.3.3

- Packaged as a Cursor plugin for the Cursor Marketplace: added
  `.cursor-plugin/plugin.json`, a root `mcp.json` (hosted endpoint, bring-your-own
  key via `ADN_API_KEY`), a square `logo.png`, and README "Install in Cursor"
  one-click links. Plugin files are excluded from the npm tarball.

## 0.3.2

- Moved `agents` to devDependencies. It is only used by the Cloudflare Worker
  (`worker/`, excluded from the npm tarball); as a runtime dependency it pulled
  a large, unnecessary tree into `npx @audiodn/mcp` and forced a zod peer
  override. Stdio installs are now lean (`@modelcontextprotocol/sdk` + `zod`).
- First version published to the Official MCP Registry as `net.audiodelivery/mcp`.

## 0.3.1

- Redeploy of the hosted Cloudflare Worker endpoint; no code or tool changes.

## 0.3.0

- Added a hosted **Streamable HTTP** endpoint (Cloudflare Worker in `worker/`)
  serving the same tools at `/mcp`, plus a `/health` info route. Auth is
  bring-your-own-key via header (`Authorization: Bearer` or `X-ADN-API-Key`);
  knowledge tools work with no key, live API tools activate when a key is sent,
  and delete tools are never exposed. Deploy with `npm run deploy`.
- Made the shared core Worker-safe: `DocStore` is now data-driven
  (`DocStore.fromData`), with a Node-only fs loader (`src/docs/load-node.ts`).
  Extracted a shared tool result/error formatter (`src/tools/run.ts`).
- Added `server.json` and `mcpName` for later publication to the official MCP
  registry (npm stdio package + streamable-http remote).
- Synced canonical snapshots from the live site (`llms-full.txt` now includes
  the AudioDN MCP server section); `openapi.json` unchanged at v1.0.0.

## 0.2.0

- Split into its own repository (github.com/audiodn/mcp), published independently
  to npm as `@audiodn/mcp`. No dependency on the AudioDN monorepo; canonical docs
  are synced one-way from the public site.
- Added offline, read-only knowledge tools grounded in bundled canonical
  snapshots: `adn_about`, `adn_search_docs`, `adn_list_operations`,
  `adn_get_operation`, `adn_get_guide`, `adn_list_variant_types`. Canonical docs
  are also exposed as MCP resources.
- Added MCP tool annotations (read-only / destructive / idempotent hints).
- Gated the destructive delete tools behind `ADN_MCP_ALLOW_DELETE=1` (hidden and
  refused otherwise).
- Removed the unsupported `playlist` play-session scope; corrected upload,
  readiness, and variant tool descriptions to match the API.
- Added `adn_get_upload_session`.
- Hardened the REST client: per-request timeout, bounded retries on transient
  failures, structured errors, and no API-key leakage.
- Version now read from `package.json`. Added a vitest suite and a stdio smoke
  test.

## 0.1.0

- Initial release: MCP server exposing the AudioDN REST API as tools over stdio.

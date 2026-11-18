# Local API + MCP QA report

Date: 2026-11-18  
Org under test: **ADN** (`fb119276-9677-49c9-a727-90cdb8aed6d9`)  
Note: host port **8787** was already bound by another project (`chessmatchtv`), so the AudioDN API ran on **8789** for this pass. MCP worker on **8788** pointed at that API. Disposable creates were deleted.

## Offline suites

| Suite | Result |
| --- | --- |
| API `npm test` | **100/100 pass** (includes default-collection) |
| MCP `npm test` | **154/154 pass** |
| MCP `npm run smoke` | **SMOKE OK** (9 knowledge tools, no API key) |

## API live (direct to local worker)

### Pass

- `GET /v1/organization/:id` → 200 (~60–900ms cold), title ADN. `default_collection_id` is **null**.
- `GET /v1/plan` → 3 plans (~390ms).
- Correct billing paths: `GET /v1/subscription` (canceled, ~290ms), `GET /v1/transaction`, `GET /v1/ai_credits` (~880ms, available $100.00), activity, rates.
- `GET /v1/api_key` → metadata only (id, title, type, timestamps, scopes). Types present: api, uploader, share. No secrets.
- `GET /v1/output_preset` → 7 presets.
- `GET /v1/collection/default/track` → 200 (sentinel works).
- Omit `collection_id` and sentinel `default` on `POST /v1/track` both land in oldest collection **Test** (`11c2ef88-…`) and return a per-track upload URL.
- `POST /v1/output_preset` (transcode) + `DELETE` soft-delete → 200.
- `GET /v1/track/:random` → 404.
- Collection create with **`Idempotency-Key` header** replays the same id (~474ms then ~66ms).

### Mismatch

- Body field `idempotency_key` on collection create does **not** dedupe (created a second collection). Only the **header** works. MCP create tools that pass body keys need the client/header path verified in agent flows.
- Wrong nested paths like `/v1/organization/:id/subscription` return HTTP **200** with `{ error: "Route not found" }` instead of 404. Easy for agents to misread as success.

### Gap / uncovered

- No URL Signing key on this org, so live **signing-key delete refusal** was not exercised.
- Stripe checkout / top-up intentionally not called.
- Org has no `default_collection_id`; fallback to oldest collection works, but “Library” naming is not visible on this account.

## Fresh MCP request list

Source: [qa-request-list.md](qa-request-list.md). Driven against local MCP after headless `MCP_DEV_MODE=1` consent.

| # | Ask | Tool(s) | Outcome | Latency |
| --- | --- | --- | --- | --- |
| 1 | Who am I? | `adn_get_organization` | usable — org ADN | ~30–450ms |
| 2/12 | Upload with no file / no collection | `adn_create_track` | clarification — `action_required` / `PUT_AUDIO_BYTES`, upload URL issued, default collection | ~840–915ms |
| 3 | Private playable link | `adn_create_play_session` (+ `variants: ["hq"]`) | usable session id even **before** bytes PUT (playback will stay empty until upload) | ~200ms |
| 4 | Podcast-style setup | `adn_list_output_presets` | usable — 7 presets; category apply not exercised | ~64ms |
| 5 | Captions / transcription | `adn_search_docs` | usable — docs hits | ~6ms |
| 6/15 | Player embed | `adn_build_player_embed` | usable **without OAuth** once `scope`+`id`+`play_session_id` (or player `api_key`) provided; fails clearly if those are missing | ~8–14ms |
| 7 | Plan / sub / credits | list plans, get subscription, AI credits, transactions, rates | all usable | 137–1114ms |
| 8 | Make it louder / LUFS | `adn_search_docs` | refuse path present in docs (loudness mentioned without claiming LUFS targeting) | ~6ms |
| 9 | Processing status | `adn_get_processing` | usable — `initialized`, `upload_accepted: false` | ~329ms |
| 10 | Find by name | `adn_find_resource` | usable — exact match on “Test” | ~169ms |
| 11 | Revoke key / URL signing | `adn_list_api_keys` + docs search | list usable; signing stays docs/dashboard story | ~70ms |
| 13 | Wait before PUT | `adn_wait_for_processing` | clarification — `pending` / `UPLOAD_NOT_ACCEPTED` | ~658ms |
| 14 | Dry-run delete | `adn_delete_track` | usable — `DELETE_PREVIEW` | ~71ms |

### MCP harness

`npm run manual` → **all OK** (69 tools listed). Create-track still exposes `stage: upload_url_issued` alongside `status: action_required` / `PUT_AUDIO_BYTES`, so the existing harness assertion did **not** need a patch.

## Deploy blockers?

Nothing hard-blocking from this pass for the MCP gap work. Before deploy, worth knowing:

1. Document or fix the **200 + Route not found** on wrong billing paths.
2. Agents must send **`Idempotency-Key` header**, not only a body field.
3. Play sessions mint successfully on tracks that have not received bytes — agents should still wait on processing before treating audio as playable.
4. Local API port **8787** may collide with other Wrangler projects on this machine.

## Artifacts

- Request list: `mcp/manual/qa-request-list.md`
- Headless auth helper: `mcp/manual/qa-auth.mjs`
- Driver: `mcp/manual/qa-run.mjs`
- Raw JSON: `/tmp/adn-qa-api.json`, `/tmp/adn-qa-api2.json`, `/tmp/adn-qa-mcp.json`

# Webhooks

Configure organization webhook URLs to react to processing without polling.
Three URL columns, one per channel:

- **Track Processing** (`webhook_url`): fires when a track reaches a terminal
  status (`ready`, `incomplete`, `error`, `init_error`) or when its full file set
  is complete (`files_completed_at`) — not on transitional statuses. Event:
  `track.status_changed`.
- **Track File / Output** (`webhook_url_file`): fires once per output with
  `track_file.created` / `track_file.failed`.
- **Collection Sync** (`webhook_url_collection`): `collection.created` /
  `collection.updated` / `collection.deleted`.

## Configure via REST / MCP

Requires a **full API Access key** (not a Client-Side Player/Uploader key):

- `adn_get_webhooks` — `GET /v1/organization/{id}/webhooks`
- `adn_set_webhooks` — `PUT /v1/organization/{id}/webhooks` (empty string clears
  a URL; omitted fields are left unchanged; https only)
- `adn_test_webhook` — `POST /v1/organization/{id}/webhooks/test` (synchronously
  POSTs a synthetic sample with `test: true`; returns HTTP status + response
  snippet; does not write to the delivery log)

URLs can also still be set in the dashboard (Settings → Webhook).

## Delivery contract

Outbound deliveries are HTTP `POST` with `Content-Type: application/json` and
header `X-ADN-Event: <event>`. They are currently **unsigned** and at-least-once
with no automatic retry — make handlers idempotent (key on `track_id` +
`status`, or the event id fields). Do not claim signature verification until a
signing secret exists.

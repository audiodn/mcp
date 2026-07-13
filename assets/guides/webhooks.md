# Webhooks

Configure webhooks in the dashboard to react to processing without polling:

- **Track Processing** (`webhook_url`): fires when a track reaches a terminal
  status (`ready`, `incomplete`, `error`, `init_error`) or when its full file set
  is complete (`files_completed_at`) — not on transitional statuses.
- **Track File** (`webhook_url_file`): fires once per track file with a status of
  `success` / `failed`.
- **Collection Sync**: collection create / update / delete events.

Verify webhook authenticity and make handlers idempotent (deliveries can retry,
so the same event may arrive more than once).

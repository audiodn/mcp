# API compatibility

AudioDN's public API is stable. When integrating or refactoring:

- Do not rename endpoints, change path styles, or alter request/response shapes.
- API paths use underscores (`/v1/upload_session`, `/v1/play_session`). HTML
  component attributes use hyphens (`upload-session-id`).
- Prefer additive changes; keep backward-compatible behavior intact.
- If something seems missing, re-check the OpenAPI spec (use `adn_list_operations`
  / `adn_get_operation`) before assuming it does not exist — do not invent a
  replacement endpoint.

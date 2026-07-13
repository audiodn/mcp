# Authentication

AudioDN uses three credential types:

- **API Access key** (`Bearer` token): full server-side access. Server-only.
  Used to create upload sessions, read track status, and create play sessions.
  This is the key the MCP server itself runs with (`ADN_API_KEY`).
- **Client-Side keys** (Player / Uploader): resource-scoped keys that are safe to
  ship in a browser or app for the web components only.
- **Session IDs as capability tokens**: some endpoints are authorized by a
  session ID in the URL instead of a Bearer token and take **no** Authorization
  header:
  - `GET /v1/upload_session/{upload_session_id}`
  - `POST /v1/upload/{upload_session_id}/track`
  - `GET /v1/play_session/{play_session_id}`
  - `GET /v1/play/{play_session_id}/{play_track_id}`
  - `GET /v1/play/{play_session_id}/{play_track_id}/{variant_index}/download`

Rule: server code holds the Bearer key; the client only ever receives a session
ID or a finished signed URL. Never ship an API Access key to a browser, mobile
app, or committed file.

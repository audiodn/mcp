# Manual MCP scenarios (local)

Not part of `npm test` / CI. Use these when you want to exercise a real local
AudioDN API + MCP worker end to end.

## Terminals

**1. AudioDN API** (from `audiodn-mono`):

```bash
npm run dev:api
# → http://127.0.0.1:8787
```

**2. Account app** (from `audiodn-mono/manage`) — login, signup, org, presets:

```bash
npm run dev
# → http://localhost:3000/connect/mcp
```

Set `VITE_MCP_TXN_URL=http://127.0.0.1:8788/oauth/transaction` and
`VITE_MCP_APPROVE_URL=http://127.0.0.1:8790/approve` in `manage/.env`.

**3. Local approve bridge** (from this repo) — delivers the connection to this
MCP worker. Org creation still uses the existing Supabase project; this only
replaces the deployed function’s post to production MCP.

```bash
npm run dev:approve
# → http://127.0.0.1:8790/approve
```

**4. MCP worker** (from this repo):

```bash
cp .dev.vars.example .dev.vars
npm run dev:local
# → http://127.0.0.1:8788/mcp
```

`.dev.vars` points the worker at the local API (`ADN_API_BASE_URL`) and at the
local account app (`ACCOUNT_CONSENT_BASE_URL`, `MCP_DEV_MODE=0`). Set
`MCP_DEV_MODE=1` only if you want the stub page that grants `ADN_API_KEY`
with no user login.

## Auth once

```bash
npm run manual:auth
```

With `MCP_DEV_MODE=0` this opens the local account app. Sign up or log in,
finish onboarding, and Allow. Tokens are written to `manual/.env` as
`ADN_MCP_ACCESS_TOKEN` (and refresh). With `MCP_DEV_MODE=1` it opens the stub
consent page instead.

## Run scenarios

```bash
npm run manual
```

Prints OK/ERR for each step and exits non-zero if any check fails. Signed
upload URLs are redacted in the printed output.

Checks: list the reliability tools, get org, create a collection and retry it
with the same `idempotency_key`, find that title, miss a fake name, create a
track (`upload_url_issued` only), reject a track with no collection, read
processing before any PUT, wait for output `hq` and for playback (expect
`pending`, not a finished file), dry-run then delete the track, dry-run then
delete the collection.

## Env

| Variable | Purpose |
| --- | --- |
| `MCP_URL` | MCP endpoint (default `http://127.0.0.1:8788/mcp`) |
| `ADN_MCP_ACCESS_TOKEN` | From `manual:auth` |
| `ADN_API_BASE_URL` | On the **worker** `.dev.vars` — which AudioDN API MCP calls |

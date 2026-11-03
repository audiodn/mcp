# Manual MCP scenarios (local)

Not part of `npm test` / CI. Use these when you want to exercise a real local
AudioDN API + MCP worker end to end.

## Terminals

**1. AudioDN API** (from `audiodn-mono`):

```bash
npm run dev:api
# → http://127.0.0.1:8787
```

**2. MCP worker** (from this repo):

```bash
cp .dev.vars.example .dev.vars
# Edit .dev.vars: set ADN_API_KEY to a real API Access key from the dashboard.
npm run dev:local
# → http://127.0.0.1:8788/mcp
```

`.dev.vars` points the worker at the local API (`ADN_API_BASE_URL`) and enables
local OAuth (`MCP_DEV_MODE=1`, `MCP_ISSUER` / `MCP_RESOURCE` on port 8788).

## Auth once

```bash
npm run manual:auth
```

Opens a browser to the worker’s `/oauth/dev-consent` page. Click **Allow**.
Tokens are written to `manual/.env` as `ADN_MCP_ACCESS_TOKEN` (and refresh).

## Run scenarios

```bash
npm run manual
```

Prints OK/ERR for each step: list tools, get org, create collection, create
track, create track without collection (expect error), get/delete track, delete
missing UUID, cleanup.

## Env

| Variable | Purpose |
| --- | --- |
| `MCP_URL` | MCP endpoint (default `http://127.0.0.1:8788/mcp`) |
| `ADN_MCP_ACCESS_TOKEN` | From `manual:auth` |
| `ADN_API_BASE_URL` | On the **worker** `.dev.vars` — which AudioDN API MCP calls |

# Changelog

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

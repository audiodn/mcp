/**
 * Server-level instructions advertised to MCP clients on initialize.
 * Keep this short: hosts inject it into the model context.
 */
export const SERVER_INSTRUCTIONS = `AudioDN MCP server. Use knowledge tools (adn_get_guide, adn_search_docs, adn_list_operations) before inventing API shapes. Read the workflows guide for end-to-end patterns.

Resolve names with adn_find_resource before creating. Creating a track only issues an upload URL (stage upload_url_issued) — PUT audio bytes yourself. Pass idempotency_key when retrying a create after a lost response. Persist durable IDs only (collection_id, track_id, output index, cloudflare_image_id) — never store upload_url, session IDs, or signed URLs.

Use adn_get_processing or adn_wait_for_processing for readiness (prefer those over polling adn_get_track alone). track_playback waits for a playable file when track_status_id is ready or incomplete. Wait for a specific output_index when you need a waveform/preview file. A ready track may still have optional outputs pending. Pending means call wait again with the same ids; it does not cancel workers.

Play sessions need a non-empty variants list of output indexes (historical wire field). Destructive deletes support dry_run=true — confirm with the user before a real delete. Do not claim LUFS/loudness normalization.`;

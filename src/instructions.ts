/**
 * Server-level instructions advertised to MCP clients on initialize.
 * Keep this short: hosts inject it into the model context.
 */
export const SERVER_INSTRUCTIONS = `AudioDN MCP server. Use knowledge tools (adn_get_guide, adn_search_docs, adn_list_operations) before inventing API shapes.

Upload is two steps: adn_create_upload_session, then adn_create_track_in_upload_session once per file (or pass nested track on session create). Alternatively use adn_create_track for a one-shot track + upload URL. PUT bytes to track_upload.upload_url yourself. Persist durable IDs only (collection_id, track_id, output index / base_url) — never store upload_url, session IDs, or signed URLs.

Poll adn_get_track until track.track_status_id === "ready" before playback. Play sessions require a non-empty variants list of output indexes from adn_list_output_presets (variants is the historical wire field). Pass play_session_id to the ADN Player; use signed URLs only with a custom player.

Do not claim LUFS/loudness normalization. Destructive delete tools (adn_delete_*) are available when authenticated — confirm with the user before calling them.`;

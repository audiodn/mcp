#!/usr/bin/env node
/**
 * Live MCP QA: drive the fresh request list against the local worker.
 * Secrets and upload URLs are redacted in output.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { writeFileSync } from 'node:fs';
import { loadEnvFile, mcpBase } from './lib.mjs';

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  const clone = JSON.parse(JSON.stringify(value));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (/upload_url|authorization|api_key|token|signed|secret|html/i.test(key) && typeof node[key] === 'string') {
        node[key] = `[redacted:${node[key].length}]`;
      } else {
        walk(node[key]);
      }
    }
  };
  walk(clone);
  return clone;
}

async function callTool(client, name, args = {}) {
  const t0 = Date.now();
  const res = await client.callTool({ name, arguments: args });
  const ms = Date.now() - t0;
  const text =
    res.content?.find((c) => c.type === 'text')?.text ?? JSON.stringify(res);
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep */
  }
  return { name, args, ms, isError: Boolean(res.isError), parsed: redact(parsed) };
}

function verdict(row, expect) {
  if (expect === 'usable' && !row.isError) return 'usable';
  if (expect === 'error' && row.isError) return 'usable_error';
  if (expect === 'clarification') {
    const s = row.parsed?.status || row.parsed?.code;
    if (!row.isError && (s === 'needs_input' || s === 'pending' || s === 'action_required')) return 'clarification';
  }
  if (expect === 'refuse' && !row.isError) {
    const msg = JSON.stringify(row.parsed || {}).toLowerCase();
    if (/lufs|loudness|not support|cannot|dashboard|signing|waf/.test(msg)) return 'refuse';
  }
  if (row.isError) return 'error';
  return 'usable';
}

async function main() {
  const env = loadEnvFile();
  const mcpUrl = mcpBase(env);
  const token = env.ADN_MCP_ACCESS_TOKEN;
  if (!token) {
    console.error('Missing ADN_MCP_ACCESS_TOKEN');
    process.exit(1);
  }

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'audiodn-qa', version: '0.0.0' });
  await client.connect(transport);

  const rows = [];
  const stamp = Date.now();
  const RANDOM = '11111111-1111-4111-8111-111111111111';

  // 15. Before signing in: player embed (also works authenticated)
  {
    const unauth = new Client({ name: 'audiodn-qa-unauth', version: '0.0.0' });
    const ut = new StreamableHTTPClientTransport(new URL(mcpUrl));
    await unauth.connect(ut);
    const r = await callTool(unauth, 'adn_build_player_embed', {
      track_id: RANDOM,
      mode: 'public_demo',
    });
    rows.push({
      req: 15,
      ask: 'Before signing in: build a player embed',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.parsed?.status || (r.isError ? 'error' : 'ok'),
      code: r.parsed?.code,
      note: r.parsed?.html || r.parsed?.embed ? 'embed payload present' : JSON.stringify(r.parsed).slice(0, 180),
      verdict: r.isError ? 'error' : 'usable',
    });
    await unauth.close();
  }

  // 1. Who am I
  {
    const r = await callTool(client, 'adn_get_organization', {});
    rows.push({
      req: 1,
      ask: 'Who am I / what’s my org?',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.isError ? 'error' : 'ok',
      note: r.parsed?.organization?.title || r.parsed?.title || r.parsed?.message,
      verdict: r.isError ? 'error' : 'usable',
    });
  }

  // 7. Billing / credits
  {
    for (const [tool, ask] of [
      ['adn_list_plans', 'What plans exist?'],
      ['adn_get_subscription', 'What’s my subscription?'],
      ['adn_get_ai_credits', 'What’s my AI credit balance?'],
      ['adn_list_transactions', 'Show recent transactions'],
      ['adn_get_ai_credit_rates', 'What are AI credit rates?'],
    ]) {
      const r = await callTool(client, tool, {});
      rows.push({
        req: 7,
        ask,
        tool: r.name,
        ms: r.ms,
        isError: r.isError,
        status: r.isError ? 'error' : 'ok',
        note: r.isError
          ? r.parsed?.message || r.parsed?.error || JSON.stringify(r.parsed).slice(0, 160)
          : Object.keys(r.parsed || {}).slice(0, 8).join(','),
        verdict: r.isError ? 'error' : 'usable',
      });
    }
  }

  // 10. Find by name
  {
    const r = await callTool(client, 'adn_find_resource', {
      type: 'collection',
      name: 'Test',
    });
    rows.push({
      req: 10,
      ask: 'Find the collection named Test',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.parsed?.status,
      code: r.parsed?.code,
      note: r.parsed?.resource_ids || r.parsed?.message,
      verdict: r.parsed?.status === 'success' ? 'usable' : r.parsed?.status || 'error',
    });
  }

  // 12 / 2. Upload with no file and no collection
  {
    const r = await callTool(client, 'adn_create_track', {
      file_name: `qa-mcp-${stamp}.mp3`,
      player_title: `QA MCP ${stamp}`,
    });
    const trackId = r.parsed?.track_id || r.parsed?.resource_ids?.track_id;
    rows.push({
      req: 12,
      ask: 'Create upload with no file bytes and no collection',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.parsed?.status || r.parsed?.stage,
      code: r.parsed?.code,
      note: {
        track_id: trackId,
        collection_id: r.parsed?.collection_id || r.parsed?.resource_ids?.collection_id,
        has_upload_url: Boolean(
          r.parsed?.upload_url ||
            r.parsed?.track_upload?.upload_url ||
            r.parsed?.method,
        ),
        message: r.parsed?.message,
      },
      verdict:
        r.parsed?.status === 'action_required' || r.parsed?.code === 'PUT_AUDIO_BYTES'
          ? 'clarification'
          : r.parsed?.stage === 'upload_url_issued'
            ? 'mismatch_stage'
            : r.isError
              ? 'error'
              : 'usable',
    });

    // 13. Wait for playback before PUT
    if (trackId) {
      const w = await callTool(client, 'adn_wait_for_processing', {
        target: 'track_playback',
        track_id: trackId,
        timeout_seconds: 1,
      });
      rows.push({
        req: 13,
        ask: 'Wait for playback before any bytes are uploaded',
        tool: w.name,
        ms: w.ms,
        isError: w.isError,
        status: w.parsed?.status,
        code: w.parsed?.code,
        note: w.parsed?.message,
        verdict:
          w.parsed?.status === 'pending' && w.parsed?.code === 'UPLOAD_NOT_ACCEPTED'
            ? 'clarification'
            : w.isError
              ? 'error'
              : 'mismatch',
      });

      // 9. Processing status
      const p = await callTool(client, 'adn_get_processing', { track_id: trackId });
      rows.push({
        req: 9,
        ask: 'Is this track done processing?',
        tool: p.name,
        ms: p.ms,
        isError: p.isError,
        status: p.parsed?.track_status_id || p.parsed?.status,
        note: {
          upload_accepted: p.parsed?.upload_accepted,
          playable: p.parsed?.playable,
        },
        verdict: !p.isError && p.parsed?.upload_accepted === false ? 'usable' : p.isError ? 'error' : 'usable',
      });

      // 14. dry_run delete
      const dry = await callTool(client, 'adn_delete_track', {
        track_id: trackId,
        dry_run: true,
      });
      rows.push({
        req: 14,
        ask: 'Delete a track, dry run only',
        tool: dry.name,
        ms: dry.ms,
        isError: dry.isError,
        status: dry.parsed?.dry_run === true ? 'dry_run' : dry.parsed?.status,
        code: dry.parsed?.code,
        note: dry.parsed?.message,
        verdict: !dry.isError && dry.parsed?.dry_run === true ? 'usable' : 'mismatch',
      });

      // 3. Private play session (expect pending / not ready)
      const play = await callTool(client, 'adn_create_play_session', {
        scope: 'track',
        track_id: trackId,
      });
      rows.push({
        req: 3,
        ask: 'Make a private playable link for a track',
        tool: play.name,
        ms: play.ms,
        isError: play.isError,
        status: play.parsed?.status || (play.isError ? 'error' : 'ok'),
        code: play.parsed?.code,
        note: play.parsed?.message || Object.keys(play.parsed || {}).slice(0, 8),
        verdict: play.isError ? 'error_or_not_ready' : 'usable',
      });

      // cleanup
      await callTool(client, 'adn_delete_track', { track_id: trackId });
    }
  }

  // 4. Podcast-ish presets
  {
    const r = await callTool(client, 'adn_list_output_presets', { limit: 20 });
    rows.push({
      req: 4,
      ask: 'Set this up like a podcast episode (list presets)',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.isError ? 'error' : 'ok',
      note: {
        count: (r.parsed?.output_presets || r.parsed?.variants || []).length,
      },
      verdict: r.isError ? 'error' : 'usable',
    });
  }

  // 5. Captions / transcription — ask knowledge or find transcribe preset
  {
    const r = await callTool(client, 'adn_search_docs', {
      query: 'transcription captions webvtt',
    });
    rows.push({
      req: 5,
      ask: 'Transcribe this and give me captions',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.isError ? 'error' : 'ok',
      note: Array.isArray(r.parsed?.results)
        ? `hits=${r.parsed.results.length}`
        : JSON.stringify(r.parsed).slice(0, 160),
      verdict: r.isError ? 'error' : 'usable',
    });
  }

  // 6. Embed (authenticated)
  {
    const r = await callTool(client, 'adn_build_player_embed', {
      track_id: RANDOM,
      mode: 'public_demo',
    });
    rows.push({
      req: 6,
      ask: 'Give me an embeddable player snippet',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.isError ? 'error' : 'ok',
      note: r.parsed?.html || r.parsed?.embed ? 'embed payload present' : JSON.stringify(r.parsed).slice(0, 160),
      verdict: r.isError ? 'error' : 'usable',
    });
  }

  // 8. Make it louder / LUFS — knowledge answer should refuse claim
  {
    const r = await callTool(client, 'adn_search_docs', {
      query: 'loudness LUFS normalization',
    });
    const text = JSON.stringify(r.parsed || {}).toLowerCase();
    rows.push({
      req: 8,
      ask: 'Make my audio louder / normalize to LUFS',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.isError ? 'error' : 'ok',
      note: text.includes('lufs') || text.includes('loudness')
        ? 'docs mention loudness'
        : JSON.stringify(r.parsed).slice(0, 160),
      verdict:
        /does not|not support|cannot|no lufs|loudness normalization/.test(text)
          ? 'refuse'
          : r.isError
            ? 'error'
            : 'gap_or_unclear',
    });
  }

  // 11. List keys / signing story
  {
    const r = await callTool(client, 'adn_list_api_keys', { limit: 20 });
    rows.push({
      req: 11,
      ask: 'Revoke an API key / set up URL signing',
      tool: r.name,
      ms: r.ms,
      isError: r.isError,
      status: r.isError ? 'error' : 'ok',
      note: {
        count: (r.parsed?.api_keys || []).length,
        types: [...new Set((r.parsed?.api_keys || []).map((k) => k.api_key_type_id))],
      },
      verdict: r.isError ? 'error' : 'usable',
    });
    const docs = await callTool(client, 'adn_search_docs', {
      query: 'URL signing key HMAC dashboard',
    });
    rows.push({
      req: 11,
      ask: 'How do I set up URL signing?',
      tool: docs.name,
      ms: docs.ms,
      isError: docs.isError,
      status: docs.isError ? 'error' : 'ok',
      note: JSON.stringify(docs.parsed).toLowerCase().includes('sign')
        ? 'docs mention signing'
        : JSON.stringify(docs.parsed).slice(0, 160),
      verdict: docs.isError ? 'error' : 'usable',
    });
  }

  writeFileSync('/tmp/adn-qa-mcp.json', JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(rows, null, 2));
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

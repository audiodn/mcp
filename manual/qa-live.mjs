#!/usr/bin/env node
/**
 * Live production MCP QA against https://mcp.audiodelivery.net/mcp
 * Uses ADN_MCP_ACCESS_TOKEN from manual/.env (from manual:auth with prod URL).
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
      if (
        /upload_url|authorization|api_key|token|signed|secret|html/i.test(key) &&
        typeof node[key] === 'string'
      ) {
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
  try {
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
    return { name, ms, isError: Boolean(res.isError), parsed: redact(parsed) };
  } catch (e) {
    return {
      name,
      ms: Date.now() - t0,
      isError: true,
      parsed: { message: String(e.message || e).slice(0, 400) },
    };
  }
}

function row(ask, r, extra = {}) {
  return {
    ask,
    tool: r.name,
    ms: r.ms,
    isError: r.isError,
    status: r.parsed?.status || r.parsed?.stage || (r.isError ? 'error' : 'ok'),
    code: r.parsed?.code,
    note:
      extra.note ??
      r.parsed?.message ??
      r.parsed?.organization?.name ??
      r.parsed?.organization?.title ??
      (typeof r.parsed === 'object'
        ? Object.keys(r.parsed || {}).slice(0, 8)
        : String(r.parsed).slice(0, 120)),
    ...extra,
  };
}

async function connect(url, token) {
  const client = new Client({ name: 'audiodn-live-qa', version: '0.0.0' });
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: headers ? { headers } : undefined,
    }),
  );
  return client;
}

async function main() {
  const env = loadEnvFile();
  const mcpUrl = process.env.MCP_URL || mcpBase(env) || 'https://mcp.audiodelivery.net/mcp';
  const token = env.ADN_MCP_ACCESS_TOKEN;
  const rows = [];
  const stamp = Date.now();
  const RANDOM = '11111111-1111-4111-8111-111111111111';

  console.log(`Live MCP QA → ${mcpUrl}`);

  // --- Unauthenticated ---
  {
    const client = await connect(mcpUrl);
    const listed = await client.listTools();
    const names = listed.tools.map((t) => t.name);
    rows.push({
      ask: 'Unauth list tools',
      tool: 'listTools',
      ms: 0,
      isError: false,
      status: 'ok',
      note: { count: names.length, sample: names.slice(0, 12) },
    });

    const about = await callTool(client, 'adn_about', {});
    rows.push(row('About AudioDN (unauth)', about));

    const docs = await callTool(client, 'adn_search_docs', {
      query: 'upload track default collection',
    });
    rows.push(
      row('Search docs upload/default (unauth)', docs, {
        note: Array.isArray(docs.parsed?.results)
          ? `hits=${docs.parsed.results.length}`
          : docs.parsed?.message || Object.keys(docs.parsed || {}),
      }),
    );

    const loud = await callTool(client, 'adn_search_docs', {
      query: 'loudness LUFS normalization',
    });
    const loudText = JSON.stringify(loud.parsed || {}).toLowerCase();
    rows.push(
      row('LUFS / loudness docs (unauth)', loud, {
        note: /does not|not support|cannot|loudness/.test(loudText)
          ? 'docs address loudness'
          : JSON.stringify(loud.parsed).slice(0, 160),
      }),
    );

    // Live tool without auth should 401 / error
    const gated = await callTool(client, 'adn_get_organization', {});
    rows.push(
      row('get_organization without OAuth (expect fail)', gated, {
        expect: 'auth_required',
      }),
    );

    await client.close();
  }

  if (!token) {
    writeFileSync('/tmp/adn-qa-live.json', JSON.stringify({ mcpUrl, rows }, null, 2));
    console.log(JSON.stringify(rows, null, 2));
    console.error('\nMissing ADN_MCP_ACCESS_TOKEN — unauth section only. Run prod OAuth first.');
    process.exit(2);
  }

  // --- Authenticated ---
  const client = await connect(mcpUrl, token);
  const { tools } = await client.listTools();
  rows.push({
    ask: 'Auth list tools',
    tool: 'listTools',
    ms: 0,
    isError: false,
    status: 'ok',
    note: { count: tools.length },
  });

  const org = await callTool(client, 'adn_get_organization', {});
  rows.push(
    row('Who am I?', org, {
      note: org.parsed?.organization?.name || org.parsed?.organization?.title || org.parsed?.message,
    }),
  );

  for (const tool of [
    'adn_list_plans',
    'adn_get_subscription',
    'adn_get_ai_credits',
    'adn_list_transactions',
    'adn_get_ai_credit_rates',
    'adn_list_api_keys',
    'adn_list_output_presets',
    'adn_list_collections',
  ]) {
    const r = await callTool(client, tool, tool.includes('list') ? { limit: 20 } : {});
    rows.push(row(tool, r));
  }

  const find = await callTool(client, 'adn_find_resource', {
    type: 'collection',
    name: 'Test',
  });
  rows.push(row('Find collection Test', find));

  const track = await callTool(client, 'adn_create_track', {
    file_name: `live-qa-${stamp}.mp3`,
    player_title: `Live QA ${stamp}`,
  });
  const trackId = track.parsed?.track_id || track.parsed?.resource_ids?.track_id;
  rows.push(
    row('Create track no collection / no bytes', track, {
      note: {
        status: track.parsed?.status,
        code: track.parsed?.code,
        stage: track.parsed?.stage,
        track_id: trackId,
        has_upload: Boolean(
          track.parsed?.upload_url ||
            track.parsed?.track_upload?.upload_url ||
            track.parsed?.method,
        ),
        message: track.parsed?.message,
      },
    }),
  );

  if (trackId) {
    const wait = await callTool(client, 'adn_wait_for_processing', {
      target: 'track_playback',
      track_id: trackId,
      timeout_seconds: 1,
    });
    rows.push(row('Wait playback before PUT', wait));

    const proc = await callTool(client, 'adn_get_processing', { track_id: trackId });
    rows.push(
      row('Processing snapshot', proc, {
        note: {
          track_status_id: proc.parsed?.track_status_id,
          upload_accepted: proc.parsed?.upload_accepted,
          playable: proc.parsed?.playable,
        },
      }),
    );

    const dry = await callTool(client, 'adn_delete_track', {
      track_id: trackId,
      dry_run: true,
    });
    rows.push(row('Delete dry_run', dry));

    const play = await callTool(client, 'adn_create_play_session', {
      scope: 'track',
      track_id: trackId,
      variants: ['hq'],
    });
    const sessionId = play.parsed?.play_session_id;
    rows.push(
      row('Create play session before bytes', play, {
        note: {
          play_session_id: sessionId,
          ok: play.parsed?.ok,
          message: play.parsed?.message,
        },
      }),
    );

    if (sessionId) {
      const unauth = await connect(mcpUrl);
      const emb = await callTool(unauth, 'adn_build_player_embed', {
        scope: 'track',
        id: trackId,
        play_session_id: sessionId,
      });
      const text =
        typeof emb.parsed === 'string' ? emb.parsed : JSON.stringify(emb.parsed);
      rows.push(
        row('Unauth embed with play_session_id', emb, {
          note: {
            hasPlayerTag: /audiodn-player/.test(text),
            status: emb.parsed?.status,
          },
        }),
      );
      await unauth.close();
    }

    // disposable preset
    const preset = await callTool(client, 'adn_create_output_preset', {
      index: `live-qa-${stamp}`,
      output_type_id: 'transcode',
      title: `Live QA preset ${stamp}`,
      settings: { format: 'mp3', bitrate: 128 },
    });
    const presetId =
      preset.parsed?.output_preset_id ||
      preset.parsed?.output_preset?.id ||
      preset.parsed?.variant_id;
    rows.push(
      row('Create transcode preset', preset, {
        note: { preset_id: presetId, ok: preset.parsed?.ok, message: preset.parsed?.message },
      }),
    );
    if (presetId) {
      const delP = await callTool(client, 'adn_delete_output_preset', {
        output_preset_id: presetId,
        dry_run: false,
      });
      rows.push(row('Delete preset', delP));
    }

    await callTool(client, 'adn_delete_track', { track_id: trackId });
    rows.push({
      ask: 'Cleanup track',
      tool: 'adn_delete_track',
      status: 'ok',
      note: { track_id: trackId },
    });
  }

  // pasted key rejection: try calling with API key style if present in .dev.vars — optional
  try {
    const { readFileSync } = await import('node:fs');
    const line = readFileSync('.dev.vars', 'utf8')
      .split(/\n/)
      .find((l) => l.startsWith('ADN_API_KEY='));
    if (line) {
      const apiKey = line.slice('ADN_API_KEY='.length).trim();
      const bad = await connect(mcpUrl, apiKey);
      const r = await callTool(bad, 'adn_get_organization', {});
      rows.push(
        row('Pasted API key on hosted MCP (expect reject)', r, {
          note: r.parsed?.message || r.parsed,
        }),
      );
      await bad.close();
    }
  } catch {
    /* skip */
  }

  writeFileSync('/tmp/adn-qa-live.json', JSON.stringify({ mcpUrl, rows }, null, 2));
  console.log(JSON.stringify(rows, null, 2));

  const failures = rows.filter(
    (r) =>
      r.expect === 'auth_required'
        ? !r.isError
        : r.ask?.includes('Pasted API key')
          ? !r.isError
          : r.isError && !String(r.ask || '').includes('without OAuth'),
  );
  // Auth-required and pasted-key rows should be errors (= pass)
  const unexpected = rows.filter((r) => {
    if (String(r.ask).includes('without OAuth') || String(r.ask).includes('Pasted API key')) {
      return !r.isError;
    }
    if (r.tool === 'listTools') return false;
    if (r.ask === 'Cleanup track') return false;
    return r.isError;
  });

  await client.close();
  if (unexpected.length) {
    console.error(`\nUnexpected failures: ${unexpected.length}`);
    process.exit(1);
  }
  console.error(`\nLive QA OK (${rows.length} checks)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

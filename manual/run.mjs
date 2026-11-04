#!/usr/bin/env node
/**
 * Manual MCP scenario runner (not CI). Uses tokens from `npm run manual:auth`.
 *
 * Usage:
 *   npm run manual
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadEnvFile, mcpBase, shortJson } from './lib.mjs';

const RANDOM_UUID = '11111111-1111-4111-8111-111111111111';

function header(title) {
  console.log('\n' + '═'.repeat(64));
  console.log(title);
  console.log('═'.repeat(64));
}

const failures = [];

function resultLine(ok, label, detail) {
  const mark = ok ? 'OK ' : 'ERR';
  if (!ok) failures.push(label);
  console.log(`[${mark}] ${label}`);
  if (detail) console.log(shortJson(redact(detail)));
}

function redact(value) {
  if (!value || typeof value !== 'object') return value;
  const clone = JSON.parse(JSON.stringify(value));
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      if (/upload_url|authorization|api_key|token|signed/i.test(key)) {
        node[key] = '[redacted]';
      } else {
        walk(node[key]);
      }
    }
  };
  walk(clone);
  return clone;
}

function idOf(parsed, key) {
  return parsed?.[key] || parsed?.[key.replace(/_id$/, '')]?.id || null;
}

async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  const text =
    res.content?.find((c) => c.type === 'text')?.text ??
    JSON.stringify(res);
  let parsed = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep string */
  }
  return { isError: Boolean(res.isError), parsed, raw: text };
}

async function main() {
  const env = loadEnvFile();
  const mcpUrl = mcpBase(env);
  const token = env.ADN_MCP_ACCESS_TOKEN;
  if (!token) {
    console.error(
      'Missing ADN_MCP_ACCESS_TOKEN. Run `npm run manual:auth` first.',
    );
    process.exit(1);
  }

  header(`Manual MCP scenarios → ${mcpUrl}`);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });
  const client = new Client({ name: 'audiodn-manual', version: '0.0.0' });
  await client.connect(transport);

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  const requiredTools = [
    'adn_create_track',
    'adn_delete_track',
    'adn_find_resource',
    'adn_get_processing',
    'adn_wait_for_processing',
  ];
  resultLine(
    requiredTools.every((name) => names.includes(name)),
    'list tools (create, delete, find, processing, wait)',
    { count: names.length, missing: requiredTools.filter((name) => !names.includes(name)) },
  );

  const org = await callTool(client, 'adn_get_organization', {});
  resultLine(!org.isError, 'adn_get_organization', org.parsed);
  if (org.isError) {
    console.error('Stopping — organization read failed (check ADN_API_KEY / API).');
    await client.close();
    process.exit(1);
  }

  const title = `Manual MCP ${new Date().toISOString()}`;
  const idempotencyKey = `manual-${Date.now()}`;
  const created = await callTool(client, 'adn_create_collection', {
    title,
    idempotency_key: idempotencyKey,
  });
  resultLine(!created.isError, 'adn_create_collection', created.parsed);
  const collectionId = idOf(created.parsed, 'collection_id');
  if (!collectionId) {
    console.error('No collection_id — cannot continue track scenarios.');
    await client.close();
    process.exit(1);
  }

  const createdAgain = await callTool(client, 'adn_create_collection', {
    title,
    idempotency_key: idempotencyKey,
  });
  const replayId = idOf(createdAgain.parsed, 'collection_id');
  resultLine(
    !createdAgain.isError && replayId === collectionId,
    'adn_create_collection idempotent retry (same id)',
    { collection_id: replayId, expected: collectionId },
  );

  const found = await callTool(client, 'adn_find_resource', {
    type: 'collection',
    name: title,
  });
  resultLine(
    !found.isError &&
      found.parsed?.status === 'success' &&
      found.parsed?.resource_ids?.collection_id === collectionId,
    'adn_find_resource exact collection title',
    found.parsed,
  );

  const ambiguous = await callTool(client, 'adn_find_resource', {
    type: 'collection',
    name: 'this-name-should-not-exist-manual',
  });
  resultLine(
    !ambiguous.isError && ambiguous.parsed?.status === 'needs_input',
    'adn_find_resource missing name (needs_input, no create)',
    { status: ambiguous.parsed?.status, code: ambiguous.parsed?.code },
  );

  const track = await callTool(client, 'adn_create_track', {
    collection_id: collectionId,
    file_name: 'manual-test.mp3',
    player_title: title,
  });
  const stage = track.parsed?.stage;
  resultLine(
    !track.isError &&
      Boolean(idOf(track.parsed, 'track_id')) &&
      stage === 'upload_url_issued',
    'adn_create_track stage upload_url_issued (bytes not uploaded)',
    { stage, track_id: idOf(track.parsed, 'track_id'), message: track.parsed?.message },
  );
  const trackId = idOf(track.parsed, 'track_id');

  const noCollection = await callTool(client, 'adn_create_track', {
    file_name: 'orphan.mp3',
  });
  resultLine(
    noCollection.isError,
    'adn_create_track without collection_id (expect error)',
    noCollection.parsed,
  );

  if (trackId) {
    const processing = await callTool(client, 'adn_get_processing', {
      track_id: trackId,
    });
    const snap = processing.parsed || {};
    resultLine(
      !processing.isError &&
        (snap.upload_accepted === false || snap.track_status_id === 'initialized'),
      'adn_get_processing before PUT (not upload_accepted)',
      {
        track_status_id: snap.track_status_id,
        upload_accepted: snap.upload_accepted,
        playable: snap.playable,
        outputs: (snap.outputs || []).map((o) => ({
          index: o.index,
          state: o.state,
        })),
      },
    );

    const waitOutput = await callTool(client, 'adn_wait_for_processing', {
      target: 'track_output',
      track_id: trackId,
      output_index: 'hq',
      timeout_seconds: 1,
    });
    const waitCode = waitOutput.parsed?.code;
    resultLine(
      !waitOutput.isError &&
        waitOutput.parsed?.status === 'pending' &&
        (waitCode === 'UPLOAD_NOT_ACCEPTED' ||
          waitCode === 'OUTPUT_PROCESSING' ||
          waitCode === 'OUTPUT_NOT_CONFIGURED' ||
          waitCode === 'PROCESSING_TIMEOUT') &&
        waitOutput.parsed?.resource_ids?.track_id === trackId,
      'adn_wait_for_processing output while track is not ready',
      {
        status: waitOutput.parsed?.status,
        code: waitCode,
        output_index: waitOutput.parsed?.output_index,
        retry_after_seconds: waitOutput.parsed?.retry_after_seconds,
        message: waitOutput.parsed?.message,
      },
    );

    const waitPlay = await callTool(client, 'adn_wait_for_processing', {
      target: 'track_playback',
      track_id: trackId,
      timeout_seconds: 1,
    });
    resultLine(
      !waitPlay.isError &&
        waitPlay.parsed?.status === 'pending' &&
        waitPlay.parsed?.code === 'UPLOAD_NOT_ACCEPTED',
      'adn_wait_for_processing playback before PUT (UPLOAD_NOT_ACCEPTED)',
      { status: waitPlay.parsed?.status, code: waitPlay.parsed?.code },
    );

    const dry = await callTool(client, 'adn_delete_track', {
      track_id: trackId,
      dry_run: true,
    });
    resultLine(
      !dry.isError && dry.parsed?.dry_run === true,
      'adn_delete_track dry_run (no delete)',
      { dry_run: dry.parsed?.dry_run, code: dry.parsed?.code },
    );

    const stillThere = await callTool(client, 'adn_get_track', { track_id: trackId });
    resultLine(!stillThere.isError, 'adn_get_track still exists after dry_run', {
      track_id: trackId,
    });

    const del = await callTool(client, 'adn_delete_track', { track_id: trackId });
    resultLine(!del.isError, 'adn_delete_track (created)', del.parsed);

    const after = await callTool(client, 'adn_get_track', { track_id: trackId });
    resultLine(
      after.isError,
      'adn_get_track after delete (expect error)',
      after.parsed,
    );
  } else {
    resultLine(false, 'skip processing/delete — create did not return track_id');
  }

  const delMissing = await callTool(client, 'adn_delete_track', {
    track_id: RANDOM_UUID,
  });
  resultLine(
    delMissing.isError,
    'adn_delete_track random UUID (expect error)',
    delMissing.parsed,
  );

  const preview = await callTool(client, 'adn_delete_collection', {
    collection_id: collectionId,
    dry_run: true,
  });
  resultLine(
    !preview.isError && preview.parsed?.dry_run === true,
    'adn_delete_collection dry_run',
    { dry_run: preview.parsed?.dry_run, track_count: preview.parsed?.track_count },
  );

  const delCol = await callTool(client, 'adn_delete_collection', {
    collection_id: collectionId,
  });
  resultLine(
    !delCol.isError,
    'adn_delete_collection cleanup',
    delCol.parsed,
  );

  header(failures.length ? `Done with ${failures.length} failure(s)` : 'Done');
  if (failures.length) {
    console.log(failures.map((label) => ` - ${label}`).join('\n'));
  }
  await client.close();
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

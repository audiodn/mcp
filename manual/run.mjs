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

function resultLine(ok, label, detail) {
  const mark = ok ? 'OK ' : 'ERR';
  console.log(`[${mark}] ${label}`);
  if (detail) console.log(shortJson(detail));
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
  resultLine(
    names.includes('adn_create_track') && names.includes('adn_delete_track'),
    'list tools (expect create_track + delete_track)',
    { count: names.length, hasCreate: names.includes('adn_create_track'), hasDelete: names.includes('adn_delete_track') },
  );

  const org = await callTool(client, 'adn_get_organization', {});
  resultLine(!org.isError, 'adn_get_organization', org.parsed);
  if (org.isError) {
    console.error('Stopping — organization read failed (check ADN_API_KEY / API).');
    await client.close();
    process.exit(1);
  }

  const title = `Manual MCP ${new Date().toISOString()}`;
  const created = await callTool(client, 'adn_create_collection', { title });
  resultLine(!created.isError, 'adn_create_collection', created.parsed);
  const collectionId =
    created.parsed?.collection_id ||
    created.parsed?.collection?.id ||
    null;
  if (!collectionId) {
    console.error('No collection_id — cannot continue track scenarios.');
    await client.close();
    process.exit(1);
  }

  const track = await callTool(client, 'adn_create_track', {
    collection_id: collectionId,
    file_name: 'manual-test.mp3',
  });
  resultLine(
    !track.isError && Boolean(track.parsed?.track_id || track.parsed?.track?.id),
    'adn_create_track (in collection)',
    track.parsed,
  );
  const trackId = track.parsed?.track_id || track.parsed?.track?.id || null;

  const noCollection = await callTool(client, 'adn_create_track', {
    file_name: 'orphan.mp3',
  });
  resultLine(
    noCollection.isError,
    'adn_create_track without collection_id (expect error)',
    noCollection.parsed,
  );

  if (trackId) {
    const get = await callTool(client, 'adn_get_track', { track_id: trackId });
    resultLine(!get.isError, 'adn_get_track (created)', {
      track_id: trackId,
      status: get.parsed?.track?.track_status_id || get.parsed?.track_status_id,
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
    resultLine(false, 'skip get/delete track — create did not return track_id');
  }

  const delMissing = await callTool(client, 'adn_delete_track', {
    track_id: RANDOM_UUID,
  });
  resultLine(
    delMissing.isError,
    'adn_delete_track random UUID (expect error)',
    delMissing.parsed,
  );

  // Best-effort cleanup of the collection (may fail if API forbids deleting
  // collections that still have soft-deleted tracks — still report it).
  const delCol = await callTool(client, 'adn_delete_collection', {
    collection_id: collectionId,
  });
  resultLine(
    true,
    `adn_delete_collection cleanup (${delCol.isError ? 'error — ok to ignore' : 'ok'})`,
    delCol.parsed,
  );

  header('Done');
  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

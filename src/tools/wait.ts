import type { AdnClient } from '../client.js';
import { pendingResult, structuredResult, type StructuredToolResult } from './structured.js';

const DEFAULT_TIMEOUT_SECONDS = 12;
const HARD_MAX_TIMEOUT_SECONDS = 15;
const POLL_INTERVAL_MS = 1500;

export type WaitTarget =
  | 'track_playback'
  | 'track_output'
  | 'track_settled'
  | 'cover';

export interface WaitArgs {
  target: WaitTarget;
  track_id?: string;
  collection_id?: string;
  output_index?: string;
  cloudflare_image_id?: string;
  timeout_seconds?: number;
}

function resolveTimeoutSeconds(requested?: number): number {
  const envRaw =
    typeof process !== 'undefined' && process.env
      ? process.env.ADN_MCP_WAIT_TIMEOUT_MS
      : undefined;
  const envCap = Number(envRaw || '');
  const envSeconds = Number.isFinite(envCap) && envCap > 0 ? envCap / 1000 : null;
  let seconds = requested ?? DEFAULT_TIMEOUT_SECONDS;
  if (envSeconds !== null) seconds = Math.min(seconds, envSeconds);
  return Math.max(1, Math.min(HARD_MAX_TIMEOUT_SECONDS, seconds));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uploadNotAccepted(snapshot: any): boolean {
  if (!snapshot || snapshot.cover) return false;
  if (snapshot.upload_accepted === false) return true;
  return (
    snapshot.upload_accepted == null && snapshot.track_status_id === 'initialized'
  );
}

function findOutput(snapshot: any, outputIndex: string): any | undefined {
  return (snapshot?.outputs || []).find(
    (o: any) => String(o.index).toLowerCase() === outputIndex.toLowerCase(),
  );
}

function pendingAfterBudget(
  args: WaitArgs,
  snapshot: any,
  timeoutSeconds: number,
): StructuredToolResult {
  const extra = {
    resource_ids: {
      track_id: args.track_id,
      collection_id: args.collection_id,
      cloudflare_image_id: args.cloudflare_image_id,
    },
    target: args.target,
    output_index: args.output_index,
    snapshot,
  };
  if (args.target === 'track_output' && args.output_index && snapshot) {
    const match = findOutput(snapshot, args.output_index);
    if (match && (match.state === 'pending' || match.state === 'processing')) {
      return pendingResult(
        'OUTPUT_PROCESSING',
        `Output "${args.output_index}" is still processing. Call adn_wait_for_processing again with the same track_id and output_index.`,
        5,
        { ...extra, output: match },
      );
    }
  }
  return pendingResult(
    'PROCESSING_TIMEOUT',
    `Still processing after ${timeoutSeconds}s; call adn_wait_for_processing again with the same ids`,
    5,
    extra,
  );
}

function evaluatePlayback(snapshot: any): StructuredToolResult | null {
  const status = snapshot.track_status_id;
  if (status === 'error' || status === 'init_error') {
    return structuredResult({
      status: 'terminal_error',
      code: 'OUTPUT_FAILED',
      message: `Track processing failed with status ${status}`,
      retryable: false,
      resource_ids: { track_id: snapshot.track_id },
      snapshot,
    });
  }
  if (snapshot.playable && (status === 'ready' || status === 'incomplete')) {
    const optionalPending = (snapshot.outputs || []).filter(
      (o: any) => !o.is_required && (o.state === 'pending' || o.state === 'failed'),
    );
    return structuredResult({
      status: optionalPending.some((o: any) => o.state === 'failed')
        ? 'partial_success'
        : 'success',
      code: status === 'incomplete' ? 'PLAYABLE_WITH_REQUIRED_FAILURE' : 'PLAYABLE',
      message:
        status === 'incomplete'
          ? 'Track is playable but a required output failed'
          : 'Track is playable',
      resource_ids: { track_id: snapshot.track_id },
      track_status_id: status,
      playable: true,
      optional_outputs: optionalPending,
      snapshot,
    });
  }
  return null;
}

function evaluateOutput(snapshot: any, outputIndex: string): StructuredToolResult | null {
  const match = findOutput(snapshot, outputIndex);
  if (!match) {
    return structuredResult({
      status: 'terminal_error',
      code: 'OUTPUT_NOT_CONFIGURED',
      message: `Output index "${outputIndex}" is not configured for this track`,
      retryable: false,
      resource_ids: { track_id: snapshot.track_id },
      snapshot,
    });
  }
  if (match.state === 'ready') {
    return structuredResult({
      status: 'success',
      code: 'OUTPUT_READY',
      message: `Output "${outputIndex}" is ready`,
      resource_ids: { track_id: snapshot.track_id },
      output: match,
      snapshot,
    });
  }
  if (match.state === 'failed') {
    return structuredResult({
      status: 'terminal_error',
      code: 'OUTPUT_FAILED',
      message: match.status_text || `Output "${outputIndex}" failed`,
      retryable: false,
      resource_ids: { track_id: snapshot.track_id },
      output: match,
      snapshot,
    });
  }
  if (match.state === 'not_scheduled') {
    return structuredResult({
      status: 'terminal_error',
      code: 'OUTPUT_NOT_CONFIGURED',
      message: `Output "${outputIndex}" is not scheduled and cannot be waited on`,
      retryable: false,
      resource_ids: { track_id: snapshot.track_id },
      output: match,
      snapshot,
    });
  }
  return null;
}

function evaluateSettled(snapshot: any): StructuredToolResult | null {
  if (!snapshot.files_completed_at) return null;
  const failed = (snapshot.outputs || []).filter((o: any) => o.state === 'failed');
  return structuredResult({
    status: failed.length ? 'partial_success' : 'success',
    code: failed.length ? 'SETTLED_WITH_FAILURES' : 'SETTLED',
    message: failed.length
      ? 'All outputs settled; some failed'
      : 'All outputs settled successfully',
    resource_ids: { track_id: snapshot.track_id },
    failed_outputs: failed,
    snapshot,
  });
}

function evaluateCover(coverPayload: any): StructuredToolResult | null {
  const cover = coverPayload.cover || coverPayload;
  if (cover.state === 'not_found') {
    return structuredResult({
      status: 'terminal_error',
      code: 'RESOURCE_NOT_FOUND',
      message: 'Cover image not found',
      retryable: false,
      cover,
    });
  }
  if (cover.state === 'superseded') {
    return structuredResult({
      status: 'terminal_error',
      code: 'COVER_SUPERSEDED',
      message: 'A newer cover replaced this image before analysis finished',
      retryable: false,
      cover,
    });
  }
  if (cover.state === 'failed') {
    return structuredResult({
      status: 'terminal_error',
      code: 'OUTPUT_FAILED',
      message: cover.status_text || 'Cover colour extraction failed',
      retryable: false,
      cover,
    });
  }
  if (cover.state === 'ready') {
    return structuredResult({
      status: 'success',
      code: 'COVER_READY',
      message: 'Cover analysis is complete',
      theme: cover.theme,
      player_color: cover.player_color,
      cover,
    });
  }
  return null;
}

export async function waitForProcessing(
  client: AdnClient,
  args: WaitArgs,
): Promise<StructuredToolResult> {
  const timeoutSeconds = resolveTimeoutSeconds(args.timeout_seconds);
  const deadline = Date.now() + timeoutSeconds * 1000;

  if (args.target === 'track_output' && !args.output_index) {
    return structuredResult({
      status: 'needs_input',
      code: 'OUTPUT_INDEX_REQUIRED',
      message: 'output_index is required for target=track_output',
      retryable: false,
    });
  }
  if (args.target === 'cover' && !args.cloudflare_image_id) {
    return structuredResult({
      status: 'needs_input',
      code: 'COVER_IMAGE_REQUIRED',
      message: 'cloudflare_image_id is required for target=cover',
      retryable: false,
    });
  }
  if (
    (args.target === 'track_playback' ||
      args.target === 'track_output' ||
      args.target === 'track_settled') &&
    !args.track_id
  ) {
    return structuredResult({
      status: 'needs_input',
      code: 'TRACK_REQUIRED',
      message: 'track_id is required for this wait target',
      retryable: false,
    });
  }
  if (args.target === 'cover' && !args.track_id && !args.collection_id) {
    return structuredResult({
      status: 'needs_input',
      code: 'RESOURCE_REQUIRED',
      message: 'collection_id or track_id is required for target=cover',
      retryable: false,
    });
  }

  let lastSnapshot: unknown = null;
  while (Date.now() < deadline) {
    let done: StructuredToolResult | null = null;
    if (args.target === 'cover') {
      const coverPayload = args.track_id
        ? await client.getTrackCoverStatus(args.track_id, args.cloudflare_image_id!)
        : await client.getCollectionCoverStatus(
            args.collection_id!,
            args.cloudflare_image_id!,
          );
      lastSnapshot = coverPayload;
      done = evaluateCover(coverPayload);
    } else {
      const snapshot: any = await client.getTrackProcessing(args.track_id!);
      lastSnapshot = snapshot;
      if (uploadNotAccepted(snapshot)) {
        return pendingResult(
          'UPLOAD_NOT_ACCEPTED',
          'Audio bytes have not been accepted yet. PUT the file to the upload URL, then call adn_wait_for_processing again with the same ids.',
          5,
          {
            resource_ids: {
              track_id: args.track_id,
              collection_id: args.collection_id,
            },
            target: args.target,
            output_index: args.output_index,
            snapshot,
          },
        );
      }
      if (args.target === 'track_playback') done = evaluatePlayback(snapshot);
      else if (args.target === 'track_output') {
        done = evaluateOutput(snapshot, args.output_index!);
      } else if (args.target === 'track_settled') {
        done = evaluateSettled(snapshot);
      }
    }
    if (done) return done;

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(POLL_INTERVAL_MS, remaining));
  }

  return pendingAfterBudget(args, lastSnapshot, timeoutSeconds);
}

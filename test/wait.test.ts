import { describe, expect, it, vi } from 'vitest';
import { waitForProcessing } from '../src/tools/wait.js';
import { findResource } from '../src/tools/find.js';
import type { AdnClient } from '../src/client.js';

function mockClient(overrides: Partial<AdnClient> = {}): AdnClient {
  return {
    getTrackProcessing: vi.fn(),
    getTrackCoverStatus: vi.fn(),
    getCollectionCoverStatus: vi.fn(),
    listCollections: vi.fn(),
    listCreators: vi.fn(),
    listTracks: vi.fn(),
    ...overrides,
  } as unknown as AdnClient;
}

describe('waitForProcessing', () => {
  it('returns playable success for ready tracks without waiting for optional outputs', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'ready',
        playable: true,
        outputs: [
          { index: 'hq', output_type_id: 'transcode', state: 'ready', is_required: true },
          { index: 'wave', output_type_id: 'waveform_image', state: 'pending', is_required: false },
        ],
      }),
    });

    const result = await waitForProcessing(client, {
      target: 'track_playback',
      track_id: 't1',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('success');
    expect(result.code).toBe('PLAYABLE');
  });

  it('treats incomplete as playable when playable is true', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'incomplete',
        playable: true,
        outputs: [],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_playback',
      track_id: 't1',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('success');
    expect(result.code).toBe('PLAYABLE_WITH_REQUIRED_FAILURE');
  });

  it('stops immediately on error status', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'error',
        playable: false,
        outputs: [],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_playback',
      track_id: 't1',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('terminal_error');
    expect(result.code).toBe('OUTPUT_FAILED');
  });

  it('returns not_configured when the output index is missing', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'processing',
        playable: false,
        outputs: [{ index: 'hq', output_type_id: 'transcode', state: 'pending' }],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_output',
      track_id: 't1',
      output_index: 'wave',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('terminal_error');
    expect(result.code).toBe('OUTPUT_NOT_CONFIGURED');
  });

  it('returns UPLOAD_NOT_ACCEPTED immediately when bytes have not arrived', async () => {
    const getTrackProcessing = vi.fn().mockResolvedValue({
      track_id: 't1',
      track_status_id: 'initialized',
      upload_accepted: false,
      playable: false,
      outputs: [{ index: 'hq', output_type_id: 'transcode', state: 'not_scheduled' }],
    });
    const client = mockClient({ getTrackProcessing });
    const started = Date.now();
    const result = await waitForProcessing(client, {
      target: 'track_output',
      track_id: 't1',
      output_index: 'hq',
      timeout_seconds: 12,
    });
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.status).toBe('pending');
    expect(result.code).toBe('UPLOAD_NOT_ACCEPTED');
    expect(result.retryable).toBe(true);
    expect((result.resource_ids as any).track_id).toBe('t1');
    expect((result as any).output_index).toBe('hq');
    expect(getTrackProcessing).toHaveBeenCalledTimes(1);
  });

  it('returns OUTPUT_PROCESSING for an output that is still in flight', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'processing',
        upload_accepted: true,
        playable: false,
        outputs: [
          { index: 'hq', output_type_id: 'transcode', state: 'pending', is_required: true },
        ],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_output',
      track_id: 't1',
      output_index: 'hq',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('pending');
    expect(result.code).toBe('OUTPUT_PROCESSING');
    expect(result.retry_after_seconds).toBe(5);
    expect((result as any).output_index).toBe('hq');
    expect((result.resource_ids as any).track_id).toBe('t1');
  });

  it('a later wait returns the finished output without creating anything', async () => {
    const getTrackProcessing = vi
      .fn()
      .mockResolvedValueOnce({
        track_id: 't1',
        track_status_id: 'processing',
        upload_accepted: true,
        playable: false,
        outputs: [{ index: 'hq', state: 'pending', is_required: true }],
      })
      .mockResolvedValueOnce({
        track_id: 't1',
        track_status_id: 'ready',
        upload_accepted: true,
        playable: true,
        outputs: [{ index: 'hq', output_type_id: 'transcode', state: 'ready', is_required: true }],
      });
    const client = mockClient({ getTrackProcessing });

    const first = await waitForProcessing(client, {
      target: 'track_output',
      track_id: 't1',
      output_index: 'hq',
      timeout_seconds: 1,
    });
    expect(first.code).toBe('OUTPUT_PROCESSING');

    const second = await waitForProcessing(client, {
      target: 'track_output',
      track_id: 't1',
      output_index: 'hq',
      timeout_seconds: 1,
    });
    expect(second.status).toBe('success');
    expect(second.code).toBe('OUTPUT_READY');
    expect(getTrackProcessing).toHaveBeenCalledTimes(2);
  });

  it('returns pending after the timeout budget', async () => {
    const client = mockClient({
      getTrackProcessing: vi.fn().mockResolvedValue({
        track_id: 't1',
        track_status_id: 'processing',
        playable: false,
        outputs: [],
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'track_playback',
      track_id: 't1',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('pending');
    expect(result.code).toBe('PROCESSING_TIMEOUT');
    expect(result.retryable).toBe(true);
  });

  it('returns superseded for a cover wait when the image is no longer current', async () => {
    const client = mockClient({
      getTrackCoverStatus: vi.fn().mockResolvedValue({
        cover: {
          state: 'superseded',
          superseded: true,
          cloudflare_image_id: 'img-a',
        },
      }),
    });
    const result = await waitForProcessing(client, {
      target: 'cover',
      track_id: 't1',
      cloudflare_image_id: 'img-a',
      timeout_seconds: 1,
    });
    expect(result.status).toBe('terminal_error');
    expect(result.code).toBe('COVER_SUPERSEDED');
  });
});

describe('findResource', () => {
  it('returns exact match without creating', async () => {
    const client = mockClient({
      listCollections: vi.fn().mockResolvedValue({
        exact: [{ id: 'c1', title: 'Live Sessions' }],
        partial: [],
        has_more: false,
      }),
    });
    const result = await findResource(client, {
      type: 'collection',
      name: 'Live Sessions',
    });
    expect(result.status).toBe('success');
    expect(result.code).toBe('EXACT_MATCH');
    expect((result.resource_ids as any).collection_id).toBe('c1');
  });

  it('returns ambiguous candidates for duplicate exact names', async () => {
    const client = mockClient({
      listCollections: vi.fn().mockResolvedValue({
        exact: [
          { id: 'c1', title: 'Live' },
          { id: 'c2', title: 'Live' },
        ],
        partial: [],
      }),
    });
    const result = await findResource(client, { type: 'collection', name: 'Live' });
    expect(result.status).toBe('needs_input');
    expect(result.code).toBe('COLLECTION_AMBIGUOUS');
    expect(result.candidates).toHaveLength(2);
  });

  it('requires collection_id when finding tracks', async () => {
    const client = mockClient();
    const result = await findResource(client, { type: 'track', name: 'Theme' });
    expect(result.status).toBe('needs_input');
    expect(result.code).toBe('COLLECTION_REQUIRED');
  });
});

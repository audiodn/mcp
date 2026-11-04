import { z } from 'zod';
import { organizationIdFromApiKey } from '../api-key.js';
import type { AdnClient } from '../client.js';
import { findResource } from './find.js';
import {
  DESTRUCTIVE,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolDef,
} from './types.js';
import { waitForProcessing } from './wait.js';

const limitSchema = z.number().int().min(1).max(100).optional();
const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/)
  .optional();
const expiresIn = z.number().int().min(60).max(86400).optional();

const playerFields = {
  player_title: z.string().optional(),
  player_subtitle: z.string().optional(),
  player_color: hexColor,
  is_cover_overridable: z.boolean().optional(),
  is_theme_overridable: z.boolean().optional(),
};

const nestedUploadTrack = z.object({
  file_name: z.string().min(1),
  organization_index: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  ...playerFields,
});

const listOutputPresetsSchema = z.object({
  limit: limitSchema,
  offset: z.number().int().min(0).optional(),
});

const getOutputPresetSchema = z.object({
  output_preset_id: z.string().uuid().optional(),
  variant_id: z.string().uuid().optional(),
});

const createTrackOutputSchema = z.object({
  track_id: z.string().uuid(),
  output_type_id: z.enum(['transcode', 'preview']).optional(),
  variant_type_id: z.enum(['transcode', 'preview']).optional(),
  index: z.string().min(2).max(64),
  is_required: z.boolean().optional(),
  notes: z.string().optional(),
  codec: z.enum(['aac', 'mp3', 'ogg', 'opus']).optional(),
  bitrate: z.number().int().min(12).max(320).optional(),
  is_stereo: z.boolean().optional(),
  is_strip_tags: z.boolean().optional(),
  is_strip_cover: z.boolean().optional(),
  preview_type: z.enum(['seconds', 'percent']).optional(),
  preview_seconds: z.number().optional(),
  preview_min_percent: z.number().optional(),
  preview_max_percent: z.number().optional(),
  preview_percent: z.number().optional(),
  preview_min_seconds: z.number().optional(),
  preview_max_seconds: z.number().optional(),
  preview_start_percent: z.number().min(0).max(100).optional(),
});

function requireNonEmptyBody(
  body: Record<string, unknown>,
  toolName: string,
): void {
  if (Object.keys(body).length === 0) {
    throw new Error(
      `${toolName} requires at least one field to update besides the resource id.`,
    );
  }
}

/** Live AudioDN REST API tools (reads, mutations, and deletes). */
export function createApiTools(client: AdnClient): ToolDef[] {
  return [
    // --- Organization ---
    {
      name: 'adn_get_organization',
      description:
        'Get the authenticated organization. organization_id is optional — when omitted it is derived from the API key prefix (22-char short-uuid). Prefer omitting it.',
      inputSchema: z.object({
        organization_id: z.string().uuid().optional(),
      }),
      annotations: { ...READ_ONLY, title: 'Get organization' },
      handler: (args: any) => {
        const organizationId =
          args.organization_id ?? organizationIdFromApiKey(client.getApiKey());
        return client.getOrganization(organizationId);
      },
    },
    {
      name: 'adn_update_organization',
      description:
        'Update organization player/theme fields (name, player_color, player_subtitle, cover/theme override flags). organization_id is optional and derived from the API key when omitted.',
      inputSchema: z.object({
        organization_id: z.string().uuid().optional(),
        name: z.string().optional(),
        player_color: hexColor,
        player_subtitle: z.string().optional(),
        is_cover_overridable: z.boolean().optional(),
        is_theme_overridable: z.boolean().optional(),
      }),
      annotations: { ...WRITE_IDEMPOTENT, title: 'Update organization' },
      handler: (args: any) => {
        const { organization_id, ...body } = args;
        requireNonEmptyBody(body, 'adn_update_organization');
        const organizationId =
          organization_id ?? organizationIdFromApiKey(client.getApiKey());
        return client.updateOrganization(organizationId, body);
      },
    },

    // --- Client-side API keys ---
    {
      name: 'adn_create_client_key',
      description:
        'Mint a scoped Client-Side key (player, uploader, or share) via POST /v1/api_key. Requires an API Access key. The full key is returned once — do not commit or log it. Share keys require exactly one variant and ignore expires_at. Cannot create API Access ("api") keys (dashboard only). track_id requires collection_id.',
      inputSchema: z.object({
        title: z.string().min(2),
        api_key_type_id: z.enum(['player', 'uploader', 'share']),
        collection_id: z.string().uuid().optional(),
        track_id: z.string().uuid().optional(),
        creator_id: z.string().uuid().optional(),
        variants: z.array(z.string().min(1)).optional(),
        expires_at: z.string().optional(),
      }),
      annotations: { ...WRITE, title: 'Create client-side API key' },
      handler: (args: any) => {
        if (args.track_id && !args.collection_id) {
          throw new Error(
            'adn_create_client_key: track_id requires collection_id.',
          );
        }
        if (args.api_key_type_id === 'share') {
          if (!args.variants || args.variants.length !== 1) {
            throw new Error(
              'adn_create_client_key: share keys require exactly one variant (e.g. ["hq"]).',
            );
          }
        }
        return client.createApiKey(args);
      },
    },

    // --- Creators ---
    {
      name: 'adn_list_creators',
      description:
        'List creators on the authenticated AudioDN organization. Prefer adn_find_resource for name lookup. Optional q filters by organization_index.',
      inputSchema: z.object({
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
        q: z.string().optional(),
      }),
      annotations: { ...READ_ONLY, title: 'List creators' },
      handler: (args: any) => client.listCreators(args),
    },
    {
      name: 'adn_get_creator',
      description: 'Get details about a specific creator by ID.',
      inputSchema: z.object({ creator_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get creator' },
      handler: (args: any) => client.getCreator(args.creator_id),
    },
    {
      name: 'adn_create_creator',
      description:
        'Create a new creator (a sub-account used to classify collections and tracks and track per-creator usage). organization_index is your own external identifier for the creator. Provisions a dedicated storage folder linked via folder_id.',
      inputSchema: z.object({
        organization_index: z.string().min(1),
        metadata: z.record(z.unknown()).optional(),
      }),
      annotations: { ...WRITE, title: 'Create creator' },
      handler: (args: any) => client.createCreator(args),
    },
    {
      name: 'adn_update_creator',
      description: 'Update an existing creator.',
      inputSchema: z.object({
        creator_id: z.string().uuid(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
      }),
      annotations: { ...WRITE_IDEMPOTENT, title: 'Update creator' },
      handler: (args: any) => {
        const { creator_id, ...body } = args;
        requireNonEmptyBody(body, 'adn_update_creator');
        return client.updateCreator(creator_id, body);
      },
    },
    {
      name: 'adn_delete_creator',
      description:
        'Delete a creator. Destructive. Pass dry_run=true to preview; confirm with the user before calling without dry_run.',
      inputSchema: z.object({
        creator_id: z.string().uuid(),
        dry_run: z.boolean().optional(),
      }),
      annotations: { ...DESTRUCTIVE, title: 'Delete creator' },
      handler: async (args: any) => {
        if (args.dry_run) {
          const creator: any = await client.getCreator(args.creator_id);
          return {
            status: 'success',
            code: 'DELETE_PREVIEW',
            dry_run: true,
            creator_id: args.creator_id,
            creator: creator.creator || creator,
            message:
              'Dry run only — call again without dry_run to permanently delete this creator',
          };
        }
        return client.deleteCreator(args.creator_id);
      },
    },

    // --- Collections ---
    {
      name: 'adn_list_collections',
      description:
        'List collections on the authenticated AudioDN organization. Prefer adn_find_resource for name lookup. Optional q filters by title.',
      inputSchema: z.object({
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
        q: z.string().optional(),
      }),
      annotations: { ...READ_ONLY, title: 'List collections' },
      handler: (args: any) => client.listCollections(args),
    },
    {
      name: 'adn_get_collection',
      description: 'Get details about a specific collection by ID.',
      inputSchema: z.object({ collection_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get collection' },
      handler: (args: any) => client.getCollection(args.collection_id),
    },
    {
      name: 'adn_create_collection',
      description:
        'Create a new collection (album, podcast feed, course module). Pass idempotency_key when retrying after a lost response. May return collection_cover_upload — that is not an upload of the cover bytes.',
      inputSchema: z.object({
        title: z.string().min(1),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        theme: z.unknown().optional(),
        player_color: hexColor,
        player_subtitle: z.string().optional(),
        is_cover_overridable: z.boolean().optional(),
        is_theme_overridable: z.boolean().optional(),
        idempotency_key: z.string().min(1).max(128).optional(),
      }),
      annotations: { ...WRITE, title: 'Create collection' },
      handler: (args: any) => {
        const { idempotency_key, ...body } = args;
        return client.createCollection(body, {
          idempotencyKey: idempotency_key,
        });
      },
    },
    {
      name: 'adn_update_collection',
      description:
        'Update an existing collection (title, theme, player fields). Pass creator_id null to clear the creator association.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        title: z.string().optional(),
        creator_id: z.string().uuid().nullable().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        theme: z.unknown().optional(),
        player_color: hexColor,
        player_subtitle: z.string().optional(),
        is_cover_overridable: z.boolean().optional(),
        is_theme_overridable: z.boolean().optional(),
      }),
      annotations: { ...WRITE_IDEMPOTENT, title: 'Update collection' },
      handler: (args: any) => {
        const { collection_id, ...body } = args;
        requireNonEmptyBody(body, 'adn_update_collection');
        return client.updateCollection(collection_id, body);
      },
    },
    {
      name: 'adn_delete_collection',
      description:
        'Delete a collection and its tracks. Destructive and irreversible. Pass dry_run=true first to preview the target and track count; confirm with the user before calling without dry_run.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        dry_run: z.boolean().optional(),
      }),
      annotations: { ...DESTRUCTIVE, title: 'Delete collection' },
      handler: async (args: any) => {
        if (args.dry_run) {
          const collection: any = await client.getCollection(args.collection_id);
          const tracks: any = await client.listTracks(args.collection_id, {
            limit: 1,
          });
          return {
            status: 'success',
            code: 'DELETE_PREVIEW',
            dry_run: true,
            collection_id: args.collection_id,
            collection: collection.collection || collection,
            track_count: tracks.count ?? null,
            message:
              'Dry run only — call again without dry_run to permanently delete this collection and its tracks',
          };
        }
        return client.deleteCollection(args.collection_id);
      },
    },
    {
      name: 'adn_create_collection_cover',
      description:
        'Mint a fresh cover-image upload handle for a collection (collection_cover_upload.upload_url). The URL is short-lived — PUT the image bytes promptly and do not store the URL.',
      inputSchema: z.object({ collection_id: z.string().uuid() }),
      annotations: { ...WRITE, title: 'Create collection cover upload' },
      handler: (args: any) => client.createCollectionCover(args.collection_id),
    },

    // --- Tracks ---
    {
      name: 'adn_list_tracks',
      description:
        'List tracks in a collection. Optional q filters by player_title/file_name. Prefer adn_find_resource for name resolution.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
        q: z.string().optional(),
      }),
      annotations: { ...READ_ONLY, title: 'List tracks' },
      handler: (args: any) =>
        client.listTracks(args.collection_id, {
          limit: args.limit,
          offset: args.offset,
          q: args.q,
        }),
    },
    {
      name: 'adn_get_track',
      description:
        'Get track metadata by ID. For processing readiness prefer adn_get_processing or adn_wait_for_processing. Playable means a successful transcode/original file exists: track_status_id ready is playable; incomplete is also playable but a required output failed; error/init_error are not playable. Optional outputs may still be pending on a ready track.',
      inputSchema: z.object({ track_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get track' },
      handler: (args: any) => client.getTrack(args.track_id),
    },
    {
      name: 'adn_update_track',
      description:
        'Update track metadata and player fields (player_title or title, subtitle, color, organization_index, metadata, cover/theme override flags). Pass creator_id null to clear the creator association.',
      inputSchema: z.object({
        track_id: z.string().uuid(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        title: z.string().optional(),
        player_title: z.string().optional(),
        player_subtitle: z.string().optional(),
        player_color: hexColor,
        is_cover_overridable: z.boolean().optional(),
        is_theme_overridable: z.boolean().optional(),
        creator_id: z.string().uuid().nullable().optional(),
      }),
      annotations: { ...WRITE_IDEMPOTENT, title: 'Update track' },
      handler: (args: any) => {
        const { track_id, ...body } = args;
        requireNonEmptyBody(body, 'adn_update_track');
        return client.updateTrack(track_id, body);
      },
    },
    {
      name: 'adn_delete_track',
      description:
        'Soft-delete a single track (and its files/variants). Destructive. Pass dry_run=true to preview; confirm with the user before calling without dry_run.',
      inputSchema: z.object({
        track_id: z.string().uuid(),
        dry_run: z.boolean().optional(),
      }),
      annotations: { ...DESTRUCTIVE, title: 'Delete track' },
      handler: async (args: any) => {
        if (args.dry_run) {
          const track: any = await client.getTrack(args.track_id);
          return {
            status: 'success',
            code: 'DELETE_PREVIEW',
            dry_run: true,
            track_id: args.track_id,
            track: track.track || track,
            message:
              'Dry run only — call again without dry_run to soft-delete this track',
          };
        }
        return client.deleteTrack(args.track_id);
      },
    },
    {
      name: 'adn_create_track',
      description:
        'Create a track resource and issue a signed upload URL. stage is upload_url_issued — this does NOT upload audio bytes. The client must PUT bytes to track_upload.upload_url. Pass idempotency_key when retrying a create after a lost response. Prefer upload-session for many files.',
      inputSchema: z.object({
        collection_id: z.string().uuid().optional(),
        file_name: z.string().min(1),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        idempotency_key: z.string().min(1).max(128).optional(),
        ...playerFields,
      }),
      annotations: { ...WRITE, title: 'Create track' },
      handler: async (args: any) => {
        const { idempotency_key, ...body } = args;
        const result: any = await client.createTrack(body, {
          idempotencyKey: idempotency_key,
        });
        return {
          ...result,
          status: 'success',
          stage: result.stage || 'upload_url_issued',
          message:
            'Track created and upload URL issued. PUT audio bytes to track_upload.upload_url, then use adn_wait_for_processing.',
        };
      },
    },
    {
      name: 'adn_create_track_cover',
      description:
        'Mint a fresh cover-image upload handle for a track (track_cover_upload.upload_url). The URL is short-lived — PUT the image bytes promptly and do not store the URL.',
      inputSchema: z.object({ track_id: z.string().uuid() }),
      annotations: { ...WRITE, title: 'Create track cover upload' },
      handler: (args: any) => client.createTrackCover(args.track_id),
    },

    // --- Upload sessions ---
    {
      name: 'adn_create_upload_session',
      description:
        'Create an upload session for a collection. Returns an upload_session_id used to register tracks. By default this does NOT return an upload URL — call adn_create_track_in_upload_session next (one call per file). Optionally pass a nested track object (with file_name) to also create that first track and receive track_upload.upload_url on this response.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        expires_in: expiresIn,
        track: nestedUploadTrack.optional(),
      }),
      annotations: { ...WRITE, title: 'Create upload session' },
      handler: (args: any) => client.createUploadSession(args),
    },
    {
      name: 'adn_get_upload_session',
      description:
        'Get details about an existing upload session by ID (authorized by the session ID itself).',
      inputSchema: z.object({ upload_session_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get upload session' },
      handler: (args: any) => client.getUploadSession(args.upload_session_id),
    },
    {
      name: 'adn_create_track_in_upload_session',
      description:
        'Register a new track inside an existing upload session. Returns track_id plus a per-track signed upload target at track_upload.upload_url (use track_upload.method, which is PUT) that you upload the audio bytes to. A cover image target is returned at track_cover_upload. Call once per file. The upload URL is short-lived — do not store or cache it.',
      inputSchema: z.object({
        upload_session_id: z.string().uuid(),
        file_name: z.string().min(1),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        ...playerFields,
      }),
      annotations: { ...WRITE, title: 'Create track in upload session' },
      handler: (args: any) => {
        const { upload_session_id, ...body } = args;
        return client.createTrackInUploadSession(upload_session_id, body);
      },
    },

    // --- Play sessions ---
    {
      name: 'adn_create_play_session',
      description:
        'Mint a play session. Scope is "collection" or "track", and exactly one of collection_id / track_id must be provided (unless the API key is already scoped to that resource). The variants body field is required: a non-empty list of output indexes from adn_list_output_presets (e.g. hq, lq). Returns play_session_id, tracks, and first_track with signed output URLs under the historical variants key — pass the play_session_id to the ADN Player; use the signed URLs only with a custom player. Playlist scope is not supported.',
      inputSchema: z.object({
        scope: z.enum(['collection', 'track']),
        collection_id: z.string().uuid().optional(),
        track_id: z.string().uuid().optional(),
        variants: z.array(z.string().min(1)).min(1),
        is_downloadable: z.boolean().optional(),
        expires_in: expiresIn,
      }),
      annotations: { ...WRITE, title: 'Create play session' },
      handler: (args: any) => {
        const { scope, ...body } = args;
        if (scope === 'collection' && body.track_id) {
          throw new Error(
            'adn_create_play_session: do not pass track_id when scope is "collection".',
          );
        }
        if (scope === 'track' && body.collection_id) {
          throw new Error(
            'adn_create_play_session: do not pass collection_id when scope is "track".',
          );
        }
        return client.createPlaySession(scope, body);
      },
    },
    {
      name: 'adn_get_play_session',
      description:
        'Get details about an existing play session. Authorized by the play_session_id itself (no Bearer required).',
      inputSchema: z.object({ play_session_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get play session' },
      handler: (args: any) => client.getPlaySession(args.play_session_id),
    },
    {
      name: 'adn_get_play_track',
      description:
        'Fetch signed playback data for a track inside an existing play session (for tracks after the first, or to refresh). Response includes signed URLs keyed by output index under the variants array (wire field name). Authorized by the play_session_id; no Bearer required.',
      inputSchema: z.object({
        play_session_id: z.string().uuid(),
        play_track_id: z.string().uuid(),
      }),
      annotations: { ...READ_ONLY, title: 'Get play track' },
      handler: (args: any) =>
        client.getPlayTrack(args.play_session_id, args.play_track_id),
    },
    {
      name: 'adn_get_play_download',
      description:
        'Fetch a short-lived signed download URL for one output index of a track inside a play session. Path param variant_index is the delivery/output index (historical name). Only succeeds when the session was created with is_downloadable true (and the API key allows downloads); otherwise the API returns 403. Authorized by the play_session_id.',
      inputSchema: z.object({
        play_session_id: z.string().uuid(),
        play_track_id: z.string().uuid(),
        variant_index: z.string().min(1),
      }),
      annotations: { ...READ_ONLY, title: 'Get play download URL' },
      handler: (args: any) =>
        client.getPlayTrackDownload(
          args.play_session_id,
          args.play_track_id,
          args.variant_index,
        ),
    },

    // --- Output presets ---
    {
      name: 'adn_list_output_presets',
      description:
        'List output presets on the authenticated organization (GET /v1/output_preset). Returns rows with index, type id, and props. Use the index values as output indexes in adn_create_play_session (variants body field). See adn_list_output_types for the type catalog.',
      inputSchema: listOutputPresetsSchema,
      annotations: { ...READ_ONLY, title: 'List output presets' },
      handler: listOutputPresets,
    },
    {
      name: 'adn_list_variants',
      description: 'Legacy name for adn_list_output_presets',
      inputSchema: listOutputPresetsSchema,
      annotations: { ...READ_ONLY, title: 'List variants (legacy)' },
      handler: listOutputPresets,
    },
    {
      name: 'adn_get_output_preset',
      description:
        'Get details about a specific organization or track output preset by ID (GET /v1/output_preset/:id). Pass output_preset_id (or legacy variant_id).',
      inputSchema: getOutputPresetSchema,
      annotations: { ...READ_ONLY, title: 'Get output preset' },
      handler: getOutputPreset,
    },
    {
      name: 'adn_get_variant',
      description: 'Legacy name for adn_get_output_preset',
      inputSchema: getOutputPresetSchema,
      annotations: { ...READ_ONLY, title: 'Get variant (legacy)' },
      handler: getOutputPreset,
    },
    {
      name: 'adn_create_track_output',
      description:
        'Append a track-specific transcode or preview output to an already-processed track and queue processing (POST /v1/track/:track_id/output). Prefer output_type_id "transcode" or "preview" (variant_type_id is accepted as a legacy alias). Call adn_list_output_presets first so the new index does not collide. The track returns to processing until the new file is ready.',
      inputSchema: createTrackOutputSchema,
      annotations: { ...WRITE, title: 'Create track output' },
      handler: createTrackOutput,
    },
    {
      name: 'adn_create_track_variant',
      description: 'Legacy name for adn_create_track_output',
      inputSchema: createTrackOutputSchema,
      annotations: { ...WRITE, title: 'Create track variant (legacy)' },
      handler: createTrackOutput,
    },

    // --- Discovery & waiting ---
    {
      name: 'adn_find_resource',
      description:
        'Resolve a collection, creator, or track by name. Returns an exact match id, needs_input with candidates when ambiguous, or needs_input when nothing matches. Never creates resources and never silently picks among duplicates.',
      inputSchema: z.object({
        type: z.enum(['collection', 'creator', 'track']),
        name: z.string().min(1),
        collection_id: z.string().uuid().optional(),
      }),
      annotations: { ...READ_ONLY, title: 'Find resource by name' },
      handler: (args: any) => findResource(client, args),
    },
    {
      name: 'adn_get_processing',
      description:
        'Uncached processing snapshot for a track: track_status_id, upload_accepted, playable, and per-output state (pending/ready/failed/not_scheduled). Prefer this over adn_get_track when checking readiness.',
      inputSchema: z.object({ track_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get track processing' },
      handler: (args: any) => client.getTrackProcessing(args.track_id),
    },
    {
      name: 'adn_wait_for_processing',
      description:
        'Poll processing for a short bounded wait (default 12s, max 15s). Targets: track_playback (playable ready/incomplete), track_output (requires output_index), track_settled (files_completed_at), cover (requires cloudflare_image_id plus collection_id or track_id). Returns pending with the same ids when the budget expires — processing continues; call again to resume. Does not cancel workers.',
      inputSchema: z.object({
        target: z.enum([
          'track_playback',
          'track_output',
          'track_settled',
          'cover',
        ]),
        track_id: z.string().uuid().optional(),
        collection_id: z.string().uuid().optional(),
        output_index: z.string().optional(),
        cloudflare_image_id: z.string().uuid().optional(),
        timeout_seconds: z.number().int().min(1).max(15).optional(),
      }),
      annotations: { ...READ_ONLY, title: 'Wait for processing' },
      handler: (args: any) => waitForProcessing(client, args),
    },
  ];

  function listOutputPresets(args: any) {
    return client.listVariants(args);
  }

  function getOutputPreset(args: any) {
    const id = args.output_preset_id ?? args.variant_id;
    if (!id) {
      throw new Error('Provide output_preset_id (or legacy variant_id).');
    }
    return client.getVariant(id);
  }

  function createTrackOutput(args: any) {
    const { track_id, output_type_id, variant_type_id, ...rest } = args;
    const typeId = variant_type_id ?? output_type_id;
    if (!typeId) {
      throw new Error('Provide output_type_id (or legacy variant_type_id).');
    }
    // Prefer wire field the API still accepts on both canonical and legacy paths.
    return client.createTrackVariant(track_id, {
      ...rest,
      variant_type_id: typeId,
      ...(output_type_id ? { output_type_id } : {}),
    });
  }
}

/**
 * Explicit map of OpenAPI operationId -> MCP tool name (or null when omitted).
 * Used by the contract test so new OpenAPI operations cannot silently go unmapped.
 */
export const OPERATION_TOOL_MAP: Record<string, string | null> = {
  createApiKey: 'adn_create_client_key',
  getOrganization: 'adn_get_organization',
  updateOrganization: 'adn_update_organization',
  listCreators: 'adn_list_creators',
  createCreator: 'adn_create_creator',
  getCreator: 'adn_get_creator',
  updateCreator: 'adn_update_creator',
  deleteCreator: 'adn_delete_creator',
  listCollections: 'adn_list_collections',
  createCollection: 'adn_create_collection',
  getCollection: 'adn_get_collection',
  updateCollection: 'adn_update_collection',
  deleteCollection: 'adn_delete_collection',
  listCollectionTracks: 'adn_list_tracks',
  createCollectionCover: 'adn_create_collection_cover',
  createTrack: 'adn_create_track',
  getTrack: 'adn_get_track',
  updateTrack: 'adn_update_track',
  deleteTrack: 'adn_delete_track',
  createTrackCover: 'adn_create_track_cover',
  addTrackVariant: 'adn_create_track_variant',
  addTrackOutput: 'adn_create_track_output',
  createUploadSession: 'adn_create_upload_session',
  getUploadSession: 'adn_get_upload_session',
  createUploadSessionTrack: 'adn_create_track_in_upload_session',
  createPlaySession: 'adn_create_play_session',
  getPlaySession: 'adn_get_play_session',
  getPlayTrack: 'adn_get_play_track',
  downloadPlayTrackVariant: 'adn_get_play_download',
  listVariants: 'adn_list_variants',
  getVariant: 'adn_get_variant',
  listOutputPresets: 'adn_list_output_presets',
  getOutputPreset: 'adn_get_output_preset',
  // 302 redirect with share key in the path — not a useful MCP tool.
  getStreamRedirect: null,
};

export const OMITTED_OPERATIONS: Record<string, string> = {
  getStreamRedirect:
    'Inline share is a 302 with the share key in the path; agents should mint a share key via adn_create_client_key and document the URL, not fetch it.',
};

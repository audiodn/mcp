import { z } from 'zod';
import { organizationIdFromApiKey } from '../api-key.js';
import type { AdnClient } from '../client.js';
import {
  DESTRUCTIVE,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolDef,
} from './types.js';

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
        'List creators on the authenticated AudioDN organization. A creator is a sub-account (artist, podcaster, contributor) used to classify collections and tracks.',
      inputSchema: z.object({
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
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
        'Delete a creator. Destructive and irreversible; confirm with the user before calling.',
      inputSchema: z.object({ creator_id: z.string().uuid() }),
      annotations: { ...DESTRUCTIVE, title: 'Delete creator' },
      handler: (args: any) => client.deleteCreator(args.creator_id),
    },

    // --- Collections ---
    {
      name: 'adn_list_collections',
      description:
        'List collections on the authenticated AudioDN organization. Use this to discover existing collections before creating a new one.',
      inputSchema: z.object({
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
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
        'Create a new collection (a logical container for tracks, like an album, podcast feed, or course module). May also return a collection_cover_upload handle.',
      inputSchema: z.object({
        title: z.string().min(1),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        player_color: hexColor,
        player_subtitle: z.string().optional(),
        is_cover_overridable: z.boolean().optional(),
        is_theme_overridable: z.boolean().optional(),
      }),
      annotations: { ...WRITE, title: 'Create collection' },
      handler: (args: any) => client.createCollection(args),
    },
    {
      name: 'adn_update_collection',
      description: 'Update an existing collection.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        title: z.string().optional(),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
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
        'Delete a collection and its tracks. Destructive and irreversible; confirm with the user before calling.',
      inputSchema: z.object({ collection_id: z.string().uuid() }),
      annotations: { ...DESTRUCTIVE, title: 'Delete collection' },
      handler: (args: any) => client.deleteCollection(args.collection_id),
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
      description: 'List tracks in a collection.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        limit: limitSchema,
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { ...READ_ONLY, title: 'List tracks' },
      handler: (args: any) =>
        client.listTracks(args.collection_id, {
          limit: args.limit,
          offset: args.offset,
        }),
    },
    {
      name: 'adn_get_track',
      description:
        'Get details about a specific track by ID. Use this to poll processing readiness: a track is playable only when track.track_status_id === "ready". Other terminal statuses (incomplete, error, init_error) indicate a problem; initialized/processing/fallback/fallback_processing are transitional. Do not build playback until a track is ready. Prefer track_status_id over any legacy status alias.',
      inputSchema: z.object({ track_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get track' },
      handler: (args: any) => client.getTrack(args.track_id),
    },
    {
      name: 'adn_update_track',
      description:
        'Update track metadata and player fields (title, subtitle, color, organization_index, metadata, cover/theme override flags).',
      inputSchema: z.object({
        track_id: z.string().uuid(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        player_title: z.string().optional(),
        player_subtitle: z.string().optional(),
        player_color: hexColor,
        is_cover_overridable: z.boolean().optional(),
        is_theme_overridable: z.boolean().optional(),
        creator_id: z.string().uuid().optional(),
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
        'Soft-delete a single track (and its files/variants). Destructive; confirm with the user before calling.',
      inputSchema: z.object({ track_id: z.string().uuid() }),
      annotations: { ...DESTRUCTIVE, title: 'Delete track' },
      handler: (args: any) => client.deleteTrack(args.track_id),
    },
    {
      name: 'adn_create_track',
      description:
        'Create a track in a collection without an upload session (POST /v1/track). Returns track_id plus track_upload.upload_url (PUT the audio bytes) and an optional track_cover_upload. Prefer the upload-session flow when uploading many files; use this for a one-shot create. collection_id is required unless the API key is already scoped to a collection.',
      inputSchema: z.object({
        collection_id: z.string().uuid().optional(),
        file_name: z.string().min(1),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        ...playerFields,
      }),
      annotations: { ...WRITE, title: 'Create track' },
      handler: (args: any) => client.createTrack(args),
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

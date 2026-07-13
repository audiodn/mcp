import { z } from 'zod';
import type { AdnClient } from '../client.js';
import {
  DESTRUCTIVE,
  READ_ONLY,
  WRITE,
  WRITE_IDEMPOTENT,
  type ToolDef,
} from './types.js';

/** Live AudioDN REST API tools (reads, mutations, and gated deletes). */
export function createApiTools(client: AdnClient): ToolDef[] {
  return [
    // --- Creators ---
    {
      name: 'adn_list_creators',
      description:
        'List creators on the authenticated AudioDN organization. A creator is a sub-account (artist, podcaster, contributor) used to classify collections and tracks.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
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
        return client.updateCreator(creator_id, body);
      },
    },
    {
      name: 'adn_delete_creator',
      description:
        'Delete a creator. Destructive and irreversible; confirm with the user before calling. Requires the server to run with ADN_MCP_ALLOW_DELETE=1.',
      inputSchema: z.object({ creator_id: z.string().uuid() }),
      annotations: { ...DESTRUCTIVE, title: 'Delete creator' },
      gated: 'delete',
      handler: (args: any) => client.deleteCreator(args.creator_id),
    },

    // --- Collections ---
    {
      name: 'adn_list_collections',
      description:
        'List collections on the authenticated AudioDN organization. Use this to discover existing collections before creating a new one.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
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
        'Create a new collection (a logical container for tracks, like an album, podcast feed, or course module).',
      inputSchema: z.object({
        title: z.string().min(1),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
        player_color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        player_subtitle: z.string().optional(),
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
        player_color: z
          .string()
          .regex(/^#[0-9A-Fa-f]{6}$/)
          .optional(),
        player_subtitle: z.string().optional(),
      }),
      annotations: { ...WRITE_IDEMPOTENT, title: 'Update collection' },
      handler: (args: any) => {
        const { collection_id, ...body } = args;
        return client.updateCollection(collection_id, body);
      },
    },
    {
      name: 'adn_delete_collection',
      description:
        'Delete a collection and its tracks. Destructive and irreversible; confirm with the user before calling. Requires the server to run with ADN_MCP_ALLOW_DELETE=1.',
      inputSchema: z.object({ collection_id: z.string().uuid() }),
      annotations: { ...DESTRUCTIVE, title: 'Delete collection' },
      gated: 'delete',
      handler: (args: any) => client.deleteCollection(args.collection_id),
    },

    // --- Tracks ---
    {
      name: 'adn_list_tracks',
      description: 'List tracks in a collection.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
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
        'Get details about a specific track by ID. Use this to poll processing readiness: a track is playable only when track.track_status_id === "ready". Other terminal statuses (incomplete, error, init_error) indicate a problem; initialized/processing/fallback are transitional. Do not build playback until a track is ready.',
      inputSchema: z.object({ track_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get track' },
      handler: (args: any) => client.getTrack(args.track_id),
    },

    // --- Upload sessions ---
    {
      name: 'adn_create_upload_session',
      description:
        'Create an upload session for a collection. Returns an upload_session_id used to register tracks. This does NOT return an upload URL by itself — call adn_create_track_in_upload_session next.',
      inputSchema: z.object({
        collection_id: z.string().uuid(),
        creator_id: z.string().uuid().optional(),
        organization_index: z.string().optional(),
        metadata: z.record(z.unknown()).optional(),
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
        'Mint a play session that returns signed, time-gated playback URLs. Scope is "collection" or "track", and exactly one of collection_id / track_id must be provided. (Playlist scope is reserved for a future release and is not supported yet.)',
      inputSchema: z.object({
        scope: z.enum(['collection', 'track']),
        collection_id: z.string().uuid().optional(),
        track_id: z.string().uuid().optional(),
        variants: z.array(z.string()).optional(),
      }),
      annotations: { ...WRITE, title: 'Create play session' },
      handler: (args: any) => {
        const { scope, ...body } = args;
        return client.createPlaySession(scope, body);
      },
    },
    {
      name: 'adn_get_play_session',
      description: 'Get details about an existing play session.',
      inputSchema: z.object({ play_session_id: z.string().uuid() }),
      annotations: { ...READ_ONLY, title: 'Get play session' },
      handler: (args: any) => client.getPlaySession(args.play_session_id),
    },

    // --- Variants ---
    {
      name: 'adn_list_variants',
      description:
        'List variant configurations on the authenticated organization. These are org-configured delivery "index" values (e.g. hq, lq, preview, waveform) used in play sessions and signed URLs — distinct from the underlying variant type. See adn_list_variant_types for the type catalog.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      }),
      annotations: { ...READ_ONLY, title: 'List variants' },
      handler: (args: any) => client.listVariants(args),
    },
  ];
}

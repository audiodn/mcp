import { z } from 'zod';
import { organizationIdFromApiKey } from '../api-key.js';
import { LOCAL_READ_ONLY, type ToolDef } from './types.js';

const DEFAULT_SIZE = 'regular' as const;
const DEFAULT_PIN = 'latest';

const sizeSchema = z.enum(['x-small', 'small', 'regular']);
const layoutSchema = z.enum(['default', 'inline']);
const themeSchema = z.enum(['auto', 'dark', 'light']);
const cdnSchema = z.enum(['unpkg', 'jsdelivr']);

const embedInputSchema = z.object({
  scope: z.enum(['collection', 'track']),
  id: z.string().min(1).describe('Track or collection UUID matching scope.'),
  api_key: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Scoped Client-Side Player key (from adn_create_client_key). Never a server API Access key. Provide exactly one of api_key or play_session_id.',
    ),
  play_session_id: z
    .string()
    .uuid()
    .optional()
    .describe(
      'Server-minted play session ID. Provide exactly one of api_key or play_session_id.',
    ),
  variants: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional()
    .describe(
      'Comma-separated delivery output indexes in priority order (e.g. "hq,lq" or ["hq","lq"]). Emitted as the variants attribute the published package reads.',
    ),
  size: sizeSchema
    .optional()
    .describe(
      'Player layout size for the default layout: x-small, small, or regular (default). Omitted from the snippet when regular.',
    ),
  layout: layoutSchema
    .optional()
    .describe(
      'Player layout. default = full player; inline = compact play/pause with progress ring (no track info). Emitted as the component variant attribute.',
    ),
  height: z
    .union([z.string().min(1), z.number()])
    .optional()
    .describe('Inline layout button height (CSS length or number of px).'),
  theme: themeSchema.optional(),
  autoplay: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  downloadable: z
    .boolean()
    .optional()
    .describe(
      'Request download UI; the key/session must allow downloads for it to work.',
    ),
  cdn: cdnSchema
    .optional()
    .describe('CDN for the player script (default unpkg).'),
  pin: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Package version pin (default "latest"). Prefer a concrete semver for production embeds.',
    ),
});

type EmbedInput = z.infer<typeof embedInputSchema>;

function normalizeVariants(
  variants: string | string[] | undefined,
): string | undefined {
  if (variants == null) return undefined;
  if (Array.isArray(variants)) {
    const joined = variants.map((v) => v.trim()).filter(Boolean).join(',');
    return joined || undefined;
  }
  const trimmed = variants.trim();
  return trimmed || undefined;
}

function scriptSrc(cdn: 'unpkg' | 'jsdelivr', pin: string): string {
  const version = pin.startsWith('@') ? pin.slice(1) : pin;
  if (cdn === 'jsdelivr') {
    return `https://cdn.jsdelivr.net/npm/@audiodn/components@${version}/dist/player.js`;
  }
  return `https://unpkg.com/@audiodn/components@${version}/dist/player.js`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatHeight(height: string | number | undefined): string | undefined {
  if (height == null) return undefined;
  if (typeof height === 'number') return `${height}`;
  return height;
}

function buildPlayerEmbed(args: EmbedInput) {
  const hasKey = Boolean(args.api_key);
  const hasSession = Boolean(args.play_session_id);
  if (hasKey === hasSession) {
    throw new Error(
      'adn_build_player_embed requires exactly one of api_key (Client-Side Player key) or play_session_id.',
    );
  }

  if (args.api_key) {
    try {
      organizationIdFromApiKey(args.api_key);
    } catch (err) {
      throw new Error(
        `adn_build_player_embed: invalid api_key — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const layout = args.layout ?? 'default';
  const size = args.size ?? DEFAULT_SIZE;
  const cdn = args.cdn ?? 'unpkg';
  const pin = args.pin ?? DEFAULT_PIN;
  const variants = normalizeVariants(args.variants);
  const height = formatHeight(args.height);

  if (layout !== 'inline' && height != null) {
    throw new Error(
      'adn_build_player_embed: height applies only when layout is "inline".',
    );
  }

  const attributes: Record<string, string> = {
    scope: args.scope,
    id: args.id,
  };

  if (args.api_key) {
    attributes['api-key'] = args.api_key;
  } else if (args.play_session_id) {
    attributes['play-session-id'] = args.play_session_id;
  }

  if (variants) {
    attributes.variants = variants;
  }

  if (layout === 'inline') {
    attributes.variant = 'inline';
    if (height) attributes.height = height;
  } else if (size !== DEFAULT_SIZE) {
    attributes.size = size;
  }

  if (args.theme) attributes.theme = args.theme;
  if (args.autoplay === true) attributes.autoplay = '';
  if (args.volume != null) attributes.volume = String(args.volume);
  if (args.downloadable === true) attributes.downloadable = '';

  const attrLines = Object.entries(attributes).map(([name, value]) => {
    if (value === '') return `  ${name}`;
    return `  ${name}="${escapeAttr(value)}"`;
  });

  const script = `<script type="module" src="${scriptSrc(cdn, pin)}"></script>`;
  const element = `<audiodn-player\n${attrLines.join('\n')}\n></audiodn-player>`;
  const html = `${script}\n${element}`;

  const notes = [
    'Use a scoped Client-Side Player key (from adn_create_client_key with api_key_type_id "player"), never a server API Access key, in browser embeds.',
    'Playback waits for processing readiness — poll adn_get_processing / adn_wait_for_processing before expecting audio.',
    'Set exactly one credential on the component: api-key or play-session-id — never both, and never a signed delivery URL.',
    'The published package reads the variants attribute; do not replace it with outputs on existing embeds yet.',
  ];
  if (layout === 'inline') {
    notes.push(
      'Inline layout shows no track info (title/cover) — surface that yourself next to the button.',
    );
  }
  if (args.api_key) {
    notes.push(
      'Prefer minting the Player key via adn_create_client_key scoped to this collection/track, then paste the returned key into api_key.',
    );
  } else {
    notes.push(
      'play-session-id embeds need a backend (or agent) that refreshes the session when it expires.',
    );
  }

  return {
    status: 'success' as const,
    html,
    element,
    script,
    attributes,
    notes,
    package: '@audiodn/components',
    cdn,
    pin,
  };
}

/**
 * Offline embed composers — no network, no API key required.
 * Agents mint credentials with live tools, then call these to assemble HTML.
 */
export function createEmbedTools(): ToolDef[] {
  return [
    {
      name: 'adn_build_player_embed',
      description:
        'Compose paste-ready <audiodn-player> HTML for a collection or track. Offline — does not mint credentials. Typical flow: resolve the resource (adn_find_resource), mint a scoped Client-Side Player key (adn_create_client_key, api_key_type_id "player"), then call this with that key. Alternatively pass a server-minted play_session_id. Never pass a server API Access key. See adn_get_guide topic "web-components" for attributes and theming.',
      inputSchema: embedInputSchema,
      annotations: { ...LOCAL_READ_ONLY, title: 'Build player embed' },
      handler: (args: any) => buildPlayerEmbed(args as EmbedInput),
    },
  ];
}

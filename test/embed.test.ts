import { describe, expect, it } from 'vitest';
import { formatApiKeyForTests } from '../src/api-key.js';
import { createEmbedTools } from '../src/tools/embed.js';

const tools = createEmbedTools();
const build = tools.find((t) => t.name === 'adn_build_player_embed')!;

const ORG = '22222222-2222-4222-8222-222222222222';
const PLAYER_KEY = formatApiKeyForTests(ORG, 'p'.repeat(40));
const COLLECTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TRACK_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAY_SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function call(args: Record<string, unknown>) {
  return build.handler(args) as Record<string, unknown>;
}

describe('adn_build_player_embed', () => {
  it('is registered as local read-only', () => {
    expect(build).toBeTruthy();
    expect(build.annotations?.readOnlyHint).toBe(true);
    expect(build.annotations?.openWorldHint).toBe(false);
  });

  it('composes a collection embed with a client-side player key', () => {
    const result = call({
      scope: 'collection',
      id: COLLECTION_ID,
      api_key: PLAYER_KEY,
      variants: ['hq', 'lq'],
    });
    expect(result.status).toBe('success');
    expect(result.script).toContain(
      'https://unpkg.com/@audiodn/components@latest/dist/player.js',
    );
    expect(result.html as string).toContain('<audiodn-player');
    expect(result.html as string).toContain(`api-key="${PLAYER_KEY}"`);
    expect(result.html as string).toContain('scope="collection"');
    expect(result.html as string).toContain(`id="${COLLECTION_ID}"`);
    expect(result.html as string).toContain('variants="hq,lq"');
    expect(result.html as string).not.toContain('outputs=');
    expect(result.html as string).not.toContain('size=');
    expect(result.notes as string[]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/Client-Side Player key/),
        expect.stringMatching(/never a server API Access key/),
      ]),
    );
  });

  it('composes a track embed and accepts comma-separated variants', () => {
    const result = call({
      scope: 'track',
      id: TRACK_ID,
      api_key: PLAYER_KEY,
      variants: 'hq,lq',
    });
    expect(result.html as string).toContain('scope="track"');
    expect(result.html as string).toContain(`id="${TRACK_ID}"`);
    expect(result.html as string).toContain('variants="hq,lq"');
  });

  it('omits size when regular (default) and emits size for x-small', () => {
    const regular = call({
      scope: 'track',
      id: TRACK_ID,
      api_key: PLAYER_KEY,
      size: 'regular',
    });
    expect(regular.html as string).not.toContain('size=');

    const xsmall = call({
      scope: 'track',
      id: TRACK_ID,
      api_key: PLAYER_KEY,
      size: 'x-small',
    });
    expect(xsmall.html as string).toContain('size="x-small"');
  });

  it('emits play-session-id instead of api-key in session mode', () => {
    const result = call({
      scope: 'collection',
      id: COLLECTION_ID,
      play_session_id: PLAY_SESSION_ID,
      variants: 'hq',
    });
    expect(result.html as string).toContain(
      `play-session-id="${PLAY_SESSION_ID}"`,
    );
    expect(result.html as string).not.toContain('api-key=');
    expect(result.notes as string[]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/refreshes the session/),
      ]),
    );
  });

  it('rejects both credentials or neither', () => {
    expect(() =>
      call({
        scope: 'track',
        id: TRACK_ID,
        api_key: PLAYER_KEY,
        play_session_id: PLAY_SESSION_ID,
      }),
    ).toThrow(/exactly one/);

    expect(() =>
      call({
        scope: 'track',
        id: TRACK_ID,
      }),
    ).toThrow(/exactly one/);
  });

  it('rejects malformed api_key', () => {
    expect(() =>
      call({
        scope: 'track',
        id: TRACK_ID,
        api_key: 'not-a-real-key',
      }),
    ).toThrow(/invalid api_key/);
  });

  it('emits inline layout with variant and height', () => {
    const result = call({
      scope: 'track',
      id: TRACK_ID,
      api_key: PLAYER_KEY,
      layout: 'inline',
      height: 40,
      variants: 'hq',
    });
    expect(result.html as string).toContain('variant="inline"');
    expect(result.html as string).toContain('height="40"');
    expect(result.html as string).not.toContain('size=');
    expect(result.notes as string[]).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/shows no track info/),
      ]),
    );
  });

  it('rejects height outside inline layout', () => {
    expect(() =>
      call({
        scope: 'track',
        id: TRACK_ID,
        api_key: PLAYER_KEY,
        height: 40,
      }),
    ).toThrow(/height applies only/);
  });

  it('passes theme, autoplay, volume, and downloadable', () => {
    const result = call({
      scope: 'track',
      id: TRACK_ID,
      api_key: PLAYER_KEY,
      theme: 'dark',
      autoplay: true,
      volume: 0.5,
      downloadable: true,
      variants: 'hq',
    });
    const html = result.html as string;
    expect(html).toContain('theme="dark"');
    expect(html).toMatch(/\sautoplay(\s|>)/);
    expect(html).toContain('volume="0.5"');
    expect(html).toMatch(/\sdownloadable(\s|>)/);
  });

  it('supports jsdelivr and a pinned version', () => {
    const result = call({
      scope: 'track',
      id: TRACK_ID,
      api_key: PLAYER_KEY,
      cdn: 'jsdelivr',
      pin: '0.6.0',
    });
    expect(result.script).toBe(
      '<script type="module" src="https://cdn.jsdelivr.net/npm/@audiodn/components@0.6.0/dist/player.js"></script>',
    );
    expect(result.cdn).toBe('jsdelivr');
    expect(result.pin).toBe('0.6.0');
  });

  it('always includes the client-key advisory note', () => {
    for (const args of [
      { scope: 'track', id: TRACK_ID, api_key: PLAYER_KEY },
      {
        scope: 'collection',
        id: COLLECTION_ID,
        play_session_id: PLAY_SESSION_ID,
      },
    ]) {
      const result = call(args);
      expect(result.notes as string[]).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/never a server API Access key/),
        ]),
      );
    }
  });
});

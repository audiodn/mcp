/**
 * Optional live smoke against api.audiodelivery.net.
 * Skips entirely unless ADN_API_KEY is set in the environment.
 *
 * Safe / read-mostly: get organization, list presets, get webhooks.
 * Does not mutate customer data (no set webhooks, no uploads, no deletes).
 */
import { describe, expect, it } from 'vitest';
import { AdnClient } from '../src/client.js';
import { organizationIdFromApiKey } from '../src/api-key.js';
import { createApiTools } from '../src/tools/api-tools.js';

const apiKey = process.env.ADN_API_KEY?.trim() || '';

if (!apiKey) {
  describe('live smoke placeholder', () => {
    it('skips when ADN_API_KEY is unset (set it to exercise the live suite)', () => {
      expect(apiKey).toBe('');
    });
  });
} else {
  describe('live smoke (ADN_API_KEY)', () => {
    const client = new AdnClient({ apiKey });
    const byName = new Map(createApiTools(client).map((t) => [t.name, t]));
    const orgId = organizationIdFromApiKey(apiKey);

    it('reads the organization via adn_get_organization', async () => {
      const result: any = await byName.get('adn_get_organization')!.handler({});
      expect(result.ok).toBe(true);
      expect(result.organization_id).toBe(orgId);
      expect(result.organization?.id).toBe(orgId);
    });

    it('lists output presets', async () => {
      const result: any = await byName.get('adn_list_output_presets')!.handler({
        limit: 20,
      });
      expect(result.ok).toBe(true);
      expect(Array.isArray(result.output_presets || result.variants)).toBe(true);
    });

    it('reads webhook configuration (full API key)', async () => {
      const result: any = await byName.get('adn_get_webhooks')!.handler({});
      expect(result.ok).toBe(true);
      expect(result.organization_id).toBe(orgId);
      expect(result.webhooks).toBeTruthy();
      expect(
        Object.prototype.hasOwnProperty.call(result.webhooks, 'webhook_url'),
      ).toBe(true);
    });
  });
}

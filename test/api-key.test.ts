import { describe, expect, it } from 'vitest';
import {
  formatApiKeyForTests,
  normalizeApiKey,
  organizationIdFromApiKey,
} from '../src/api-key.js';

describe('normalizeApiKey', () => {
  it('trims and returns real keys', () => {
    expect(normalizeApiKey('  adn_abc  ')).toBe('adn_abc');
  });

  it('treats empty and placeholders as absent', () => {
    expect(normalizeApiKey('')).toBeUndefined();
    expect(normalizeApiKey('   ')).toBeUndefined();
    expect(normalizeApiKey(null)).toBeUndefined();
    expect(normalizeApiKey(undefined)).toBeUndefined();
    expect(normalizeApiKey('${env:ADN_API_KEY}')).toBeUndefined();
    expect(normalizeApiKey('${ADN_API_KEY}')).toBeUndefined();
  });
});

describe('organizationIdFromApiKey', () => {
  it('round-trips a short-uuid prefix', () => {
    const orgId = '22222222-2222-4222-8222-222222222222';
    const key = formatApiKeyForTests(orgId, 's'.repeat(40));
    expect(organizationIdFromApiKey(key)).toBe(orgId);
  });

  it('rejects short keys', () => {
    expect(() => organizationIdFromApiKey('short')).toThrow(/too short/);
  });
});

import short from 'short-uuid';

const translator = short.createTranslator();

/**
 * Derive the organization UUID from a full AudioDN API key.
 * Keys are `<22-char short-uuid org prefix><base secret>`.
 */
export function organizationIdFromApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 22) {
    throw new Error(
      'API key is too short to contain an organization prefix (expected short-uuid + secret).',
    );
  }
  const prefix = trimmed.slice(0, 22);
  try {
    return translator.toUUID(prefix);
  } catch {
    throw new Error(
      'Could not derive organization_id from the API key prefix. Pass organization_id explicitly.',
    );
  }
}

/**
 * Treat empty / uninterpolated config placeholders as "no key".
 * Cursor and similar hosts may send literally `${env:ADN_API_KEY}` when unset.
 */
export function normalizeApiKey(value?: string | null): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\$\{env:[^}]+\}$/i.test(trimmed)) return undefined;
  if (/^\$\{[^}]+\}$/.test(trimmed)) return undefined;
  return trimmed;
}

/** Build a synthetic API key for tests (org-prefix + secret). */
export function formatApiKeyForTests(organizationId: string, secret: string): string {
  return `${translator.fromUUID(organizationId)}${secret}`;
}

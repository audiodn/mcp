import { GUIDE_TOPICS, type DocStore } from './docs/store.js';

export interface ResourceDescriptor {
  uri: string;
  name: string;
  mimeType: string;
}

/** Canonical docs exposed as MCP resources (stdio and hosted). */
export function listResourceDescriptors(): ResourceDescriptor[] {
  return [
    {
      uri: 'audiodn://openapi.json',
      name: 'AudioDN OpenAPI specification',
      mimeType: 'application/json',
    },
    {
      uri: 'audiodn://llms-full.txt',
      name: 'AudioDN llms-full.txt (full docs summary)',
      mimeType: 'text/plain',
    },
    ...GUIDE_TOPICS.map((topic) => ({
      uri: `audiodn://guide/${topic}`,
      name: `AudioDN guide: ${topic}`,
      mimeType: 'text/markdown',
    })),
  ];
}

export function readResource(
  store: DocStore,
  uri: string,
): { uri: string; mimeType: string; text: string } | null {
  if (uri === 'audiodn://openapi.json') {
    return {
      uri,
      mimeType: 'application/json',
      text: store.openapiJson(),
    };
  }
  if (uri === 'audiodn://llms-full.txt') {
    return {
      uri,
      mimeType: 'text/plain',
      text: store.llmsFullText(),
    };
  }
  const guideMatch = uri.match(/^audiodn:\/\/guide\/(.+)$/);
  if (guideMatch) {
    const content = store.getGuide(guideMatch[1]);
    if (content) {
      return { uri, mimeType: 'text/markdown', text: content };
    }
  }
  return null;
}

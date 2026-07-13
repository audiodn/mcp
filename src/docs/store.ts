import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDES_DIR, SNAPSHOTS_DIR } from '../paths.js';
import { getVersion } from '../version.js';

export const GUIDE_TOPICS = [
  'authentication',
  'upload',
  'processing',
  'playback',
  'webhooks',
  'variant-types',
  'security',
  'compatibility',
] as const;

export type GuideTopic = (typeof GUIDE_TOPICS)[number];

export interface OperationSummary {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
  tags?: string[];
}

export interface VariantTypeInfo {
  type: string;
  title: string;
  description: string;
  apiCreatable: boolean;
}

export interface SearchHit {
  title: string;
  source: string;
  score: number;
  snippet: string;
}

interface CorpusDoc {
  title: string;
  source: string;
  text: string;
}

const VARIANT_TYPES: VariantTypeInfo[] = [
  {
    type: 'transcode',
    title: 'Transcoded Version',
    description:
      'Codec/bitrate/channel/metadata settings. Delivery index values like hq and lq are transcode variants.',
    apiCreatable: true,
  },
  {
    type: 'preview',
    title: 'Preview Clip',
    description: 'A clipped preview with its own transcode options.',
    apiCreatable: true,
  },
  {
    type: 'levels',
    title: 'Audio Analysis',
    description:
      'Waveform sample metrics. A default 320-sample waveform is generated for free.',
    apiCreatable: false,
  },
  {
    type: 'waveform_video',
    title: 'Waveform Video',
    description: 'An animated MP4 with optional embedded audio.',
    apiCreatable: false,
  },
  {
    type: 'waveform_image',
    title: 'Waveform Image',
    description: 'A static PNG waveform.',
    apiCreatable: false,
  },
  {
    type: 'original',
    title: 'Original Upload',
    description: 'The preserved source file.',
    apiCreatable: false,
  },
  {
    type: 'cover',
    title: 'Cover Image',
    description:
      'Embedded cover extraction plus color palette / player_color theming.',
    apiCreatable: false,
  },
];

export class DocStore {
  private openapi: any;
  private llmsFull: string;
  private sources: any;
  private guides = new Map<string, string>();
  private corpus: CorpusDoc[] = [];

  private constructor() {
    this.openapi = readJson(join(SNAPSHOTS_DIR, 'openapi.json'));
    this.llmsFull = readText(join(SNAPSHOTS_DIR, 'llms-full.txt'));
    this.sources = readJson(join(SNAPSHOTS_DIR, 'sources.json'));
    this.loadGuides();
    this.buildCorpus();
  }

  static load(): DocStore {
    return new DocStore();
  }

  /**
   * Optionally refresh openapi + llms-full from the public site when
   * ADN_MCP_LIVE_DOCS=1. Always falls back to the bundled snapshot on any
   * failure so the server stays reliable offline.
   */
  async maybeRefreshLive(): Promise<boolean> {
    if (process.env.ADN_MCP_LIVE_DOCS !== '1') return false;
    const site =
      process.env.AUDIODN_SITE || 'https://audiodeliverynetwork.com';
    try {
      const [openapiRes, llmsRes] = await Promise.all([
        fetchWithTimeout(`${site}/openapi.json`),
        fetchWithTimeout(`${site}/llms-full.txt`),
      ]);
      const openapiText = await openapiRes.text();
      const llmsText = await llmsRes.text();
      this.openapi = JSON.parse(openapiText);
      this.llmsFull = llmsText;
      this.sources = {
        ...this.sources,
        live: true,
        openapiVersion: this.openapi?.info?.version ?? this.sources?.openapiVersion,
      };
      this.buildCorpus();
      return true;
    } catch {
      return false;
    }
  }

  about() {
    return {
      serverVersion: getVersion(),
      openapiVersion: this.openapi?.info?.version ?? 'unknown',
      docsSource: this.sources?.live ? 'live' : 'bundled snapshot',
      snapshot: this.sources,
      apiBase: this.openapi?.servers?.[0]?.url ?? 'https://api.audiodelivery.net',
      guideTopics: GUIDE_TOPICS,
    };
  }

  listOperations(): OperationSummary[] {
    const out: OperationSummary[] = [];
    const paths = this.openapi?.paths ?? {};
    for (const [path, item] of Object.entries<any>(paths)) {
      for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        const op = item?.[method];
        if (!op) continue;
        out.push({
          operationId: op.operationId ?? `${method} ${path}`,
          method: method.toUpperCase(),
          path,
          summary: op.summary,
          tags: op.tags,
        });
      }
    }
    return out.sort((a, b) => a.operationId.localeCompare(b.operationId));
  }

  getOperation(operationId: string): Record<string, any> | null {
    const paths = this.openapi?.paths ?? {};
    for (const [path, item] of Object.entries<any>(paths)) {
      for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
        const op = item?.[method];
        if (op?.operationId === operationId) {
          return { method: method.toUpperCase(), path, ...op };
        }
      }
    }
    return null;
  }

  getGuide(topic: string): string | null {
    return this.guides.get(topic) ?? null;
  }

  listVariantTypes(): VariantTypeInfo[] {
    return VARIANT_TYPES;
  }

  searchDocs(query: string, limit = 5): SearchHit[] {
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const hits: SearchHit[] = [];
    for (const doc of this.corpus) {
      const haystack = doc.text.toLowerCase();
      const titleLc = doc.title.toLowerCase();
      let score = 0;
      for (const term of terms) {
        score += countOccurrences(haystack, term);
        if (titleLc.includes(term)) score += 3;
      }
      if (score > 0) {
        hits.push({
          title: doc.title,
          source: doc.source,
          score,
          snippet: makeSnippet(doc.text, terms),
        });
      }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit));
  }

  // --- resources ---
  openapiJson(): string {
    return JSON.stringify(this.openapi, null, 2);
  }

  llmsFullText(): string {
    return this.llmsFull;
  }

  private loadGuides() {
    if (!existsSync(GUIDES_DIR)) return;
    for (const file of readdirSync(GUIDES_DIR)) {
      if (!file.endsWith('.md')) continue;
      const topic = file.replace(/\.md$/, '');
      this.guides.set(topic, readText(join(GUIDES_DIR, file)));
    }
  }

  private buildCorpus() {
    const corpus: CorpusDoc[] = [];
    for (const section of splitSections(this.llmsFull)) {
      corpus.push({
        title: section.title,
        source: 'llms-full.txt',
        text: section.text,
      });
    }
    for (const op of this.listOperations()) {
      corpus.push({
        title: op.operationId,
        source: 'openapi',
        text: `${op.method} ${op.path} — ${op.summary ?? ''} (${(op.tags ?? []).join(', ')})`,
      });
    }
    for (const [topic, text] of this.guides) {
      corpus.push({ title: `guide: ${topic}`, source: 'guide', text });
    }
    this.corpus = corpus;
  }
}

function readText(path: string): string {
  return readFileSync(path, 'utf8');
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);
}

function countOccurrences(haystack: string, term: string): number {
  if (!term) return 0;
  let count = 0;
  let idx = haystack.indexOf(term);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(term, idx + term.length);
  }
  return count;
}

function makeSnippet(text: string, terms: string[]): string {
  const lc = text.toLowerCase();
  let pos = -1;
  for (const term of terms) {
    const i = lc.indexOf(term);
    if (i !== -1 && (pos === -1 || i < pos)) pos = i;
  }
  const start = pos === -1 ? 0 : Math.max(0, pos - 80);
  const snippet = text.slice(start, start + 240).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snippet + (text.length > start + 240 ? '…' : '');
}

function splitSections(text: string): Array<{ title: string; text: string }> {
  const lines = text.split('\n');
  const sections: Array<{ title: string; text: string }> = [];
  let current: { title: string; text: string } | null = null;
  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line) || /^\d+\.\s+[A-Z]/.test(line.trim())) {
      if (current) sections.push(current);
      current = { title: line.replace(/^#{1,3}\s+/, '').trim(), text: line + '\n' };
    } else if (current) {
      current.text += line + '\n';
    } else {
      current = { title: 'Overview', text: line + '\n' };
    }
  }
  if (current) sections.push(current);
  return sections.filter((s) => s.text.trim().length > 0);
}

async function fetchWithTimeout(url: string, timeoutMs = 5000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { accept: '*/*' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

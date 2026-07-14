import openapi from '../assets/snapshots/openapi.json';
import sources from '../assets/snapshots/sources.json';
import pkg from '../package.json';
import { DocStore } from '../src/docs/store.js';

// Text imports resolved by wrangler's [[rules]] Text rule (see wrangler.toml).
import llmsFull from '../assets/snapshots/llms-full.txt';
import authentication from '../assets/guides/authentication.md';
import compatibility from '../assets/guides/compatibility.md';
import playback from '../assets/guides/playback.md';
import processing from '../assets/guides/processing.md';
import security from '../assets/guides/security.md';
import upload from '../assets/guides/upload.md';
import variantTypes from '../assets/guides/variant-types.md';
import webhooks from '../assets/guides/webhooks.md';

export const version: string = (pkg as { version: string }).version;

const guides: Record<string, string> = {
  authentication,
  compatibility,
  playback,
  processing,
  security,
  upload,
  'variant-types': variantTypes,
  webhooks,
};

export const store = DocStore.fromData({
  openapi,
  llmsFull,
  sources,
  guides,
  serverVersion: version,
});

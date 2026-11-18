import { describe, expect, it } from 'vitest';
import {
  isKnowledgeToolName,
  mcpRequestRequiresOAuth,
} from '../worker/oauth/request-auth-gate.js';

describe('mcpRequestRequiresOAuth', () => {
  it('allows tools/list without auth', async () => {
    const req = new Request('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      }),
    });
    await expect(mcpRequestRequiresOAuth(req)).resolves.toBe(false);
  });

  it('allows knowledge tool calls without auth', async () => {
    const req = new Request('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'adn_about', arguments: {} },
      }),
    });
    await expect(mcpRequestRequiresOAuth(req)).resolves.toBe(false);
  });

  it('requires OAuth for live tool calls', async () => {
    const req = new Request('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'adn_create_track', arguments: { file_name: 'a.mp3' } },
      }),
    });
    await expect(mcpRequestRequiresOAuth(req)).resolves.toBe(true);
  });

  it('allows adn_build_player_embed without OAuth', async () => {
    const req = new Request('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'adn_build_player_embed', arguments: {} },
      }),
    });
    await expect(mcpRequestRequiresOAuth(req)).resolves.toBe(false);
  });

  it('requires OAuth for adn_sign_in', async () => {
    const req = new Request('https://x/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'adn_sign_in', arguments: {} },
      }),
    });
    await expect(mcpRequestRequiresOAuth(req)).resolves.toBe(true);
  });
});

describe('isKnowledgeToolName', () => {
  it('recognizes docs tools', () => {
    expect(isKnowledgeToolName('adn_about')).toBe(true);
    expect(isKnowledgeToolName('adn_get_guide')).toBe(true);
    expect(isKnowledgeToolName('adn_create_track')).toBe(false);
    expect(isKnowledgeToolName('adn_sign_in')).toBe(false);
  });
});

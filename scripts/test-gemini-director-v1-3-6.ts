import { test } from 'node:test';
import assert from 'node:assert';
import { GeminiDirectorProvider } from '../src/director-gemini.ts';
import { OllamaDirectorProvider } from '../src/director.ts';
import { discoverCapabilities } from '../src/product-capabilities.ts';
import { resolve } from 'node:path';

test('missing key => clear unavailable status', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const provider = new GeminiDirectorProvider();
  const status = await provider.checkAvailability();
  assert.strictEqual(status.available, false);
  assert.ok(status.reason?.includes('GEMINI_API_KEY environment variable is missing'));
  if (originalKey) process.env.GEMINI_API_KEY = originalKey;
});

test('API key never included in capabilities payload', async () => {
  const caps = await discoverCapabilities({ root: process.cwd() });
  const str = JSON.stringify(caps);
  if (process.env.GEMINI_API_KEY) {
    assert.ok(!str.includes(process.env.GEMINI_API_KEY));
  }
});

// To be continued...

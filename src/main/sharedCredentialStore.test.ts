import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { SharedCredentialStore } from './sharedCredentialStore';

let tempDir: string;
let store: SharedCredentialStore;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobster-credentials-'));
  store = new SharedCredentialStore(path.join(tempDir, 'credentials.env'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('SharedCredentialStore', () => {
  test('saves and reads shared credential values without exposing invalid env keys', () => {
    store.setMany({
      TAVILY_API_KEY: ' tvly-live ',
      'bad-key': 'ignored',
    });

    expect(store.getAll()).toEqual({
      TAVILY_API_KEY: 'tvly-live',
    });
    expect(store.getMany(['TAVILY_API_KEY', 'bad-key'])).toEqual({
      TAVILY_API_KEY: 'tvly-live',
    });
  });

  test('clears a shared credential when the next value is empty', () => {
    store.setMany({
      FIRECRAWL_API_KEY: 'fc-live',
    });

    store.setMany({
      FIRECRAWL_API_KEY: '   ',
    });

    expect(store.getAll()).toEqual({});
  });
});

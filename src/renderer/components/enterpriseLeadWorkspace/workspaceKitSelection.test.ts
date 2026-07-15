import { describe, expect, test } from 'vitest';

import {
  getWorkspaceDefaultKitIds,
  mergeWorkspaceKitIds,
} from './workspaceKitSelection';

describe('workspace Kit selection', () => {
  test('returns no default Kits when a workspace has none configured', () => {
    expect(getWorkspaceDefaultKitIds()).toEqual([]);
  });

  test('keeps default Kits first when merging selected Kits', () => {
    expect(mergeWorkspaceKitIds(['research'], ['research', 'risk'])).toEqual([
      'research',
      'risk',
    ]);
  });
});

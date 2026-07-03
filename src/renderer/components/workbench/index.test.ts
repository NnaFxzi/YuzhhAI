import { describe, expect, test } from 'vitest';

import * as workbenchComponents from './index';

describe('workbench component exports', () => {
  test('keeps only the visible home workbench components public', () => {
    expect(Object.keys(workbenchComponents).sort()).toEqual(['WorkbenchWorkflowGrid']);
  });
});

import { describe, expect, test } from 'vitest';

import {
  DEFAULT_USER_INFO_TEMPLATE,
  getEditableUserInfo,
} from './agentEditText';

describe('agent edit text helpers', () => {
  test('replaces the legacy English USER.md template with a Chinese editing template', () => {
    const legacyTemplate = `# USER.md - About Your Human

_Learn about the person you're helping. Update this as you go._

- **Name:**
- **What to call them:**
- **Pronouns:** _(optional)_
- **Timezone:**
- **Notes:**

## Context
`;

    expect(getEditableUserInfo(legacyTemplate)).toBe(DEFAULT_USER_INFO_TEMPLATE);
  });

  test('keeps existing user-written content unchanged', () => {
    const content = '# 关于我\n\n- 称呼：小林\n- 偏好：直接给结论';

    expect(getEditableUserInfo(content)).toBe(content);
  });
});

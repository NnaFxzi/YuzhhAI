import { describe, expect, test } from 'vitest';

import {
  KNOWLEDGE_MAX_SELECTION_FILES,
  KNOWLEDGE_SELECTION_TOKEN_TTL_MS,
  KnowledgeBaseErrorCode,
} from '../../shared/knowledgeBase/constants';
import {
  KnowledgeSelectionTokenStore,
  type SelectedKnowledgeFileInput,
} from './knowledgeSelectionTokenStore';

const selected = (name: string, size = 10): SelectedKnowledgeFileInput => ({
  absolutePath: `/private/${name}`,
  displayName: name,
  fileSize: size,
  sourceMtime: 100,
});

describe('KnowledgeSelectionTokenStore', () => {
  test('issues an owner-bound token and consumes it once', () => {
    const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
    const issued = store.issue(7, [selected('a.pdf')]);

    const consumed = store.consume(issued.selectionToken, 7);

    expect(consumed).toEqual([
      expect.objectContaining({
        absolutePath: '/private/a.pdf',
        displayName: 'a.pdf',
        itemId: issued.files[0]?.itemId,
      }),
    ]);
    expect(() => store.consume(issued.selectionToken, 7)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
    );
  });

  test('rejects foreign use without consuming the rightful owner token', () => {
    const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
    const issued = store.issue(7, [selected('a.pdf')]);

    expect(() => store.consume(issued.selectionToken, 8)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
    );
    expect(store.consume(issued.selectionToken, 7)).toHaveLength(1);
  });

  test('rejects and removes an expired token', () => {
    let now = 1_000;
    const store = new KnowledgeSelectionTokenStore({ now: () => now });
    const issued = store.issue(7, [selected('a.pdf')]);
    now += KNOWLEDGE_SELECTION_TOKEN_TTL_MS + 1;

    expect(() => store.consume(issued.selectionToken, 7)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
    );
    now = 1_000;
    expect(() => store.consume(issued.selectionToken, 7)).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidSelectionToken }),
    );
  });

  test('clears all tokens owned by a destroyed WebContents', () => {
    const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });
    const first = store.issue(7, [selected('a.pdf')]);
    const second = store.issue(7, [selected('b.pdf')]);
    const otherOwner = store.issue(8, [selected('c.pdf')]);

    store.clearOwner(7);

    expect(() => store.consume(first.selectionToken, 7)).toThrow();
    expect(() => store.consume(second.selectionToken, 7)).toThrow();
    expect(store.consume(otherOwner.selectionToken, 8)).toHaveLength(1);
  });

  test('rejects empty and oversized selections with stable codes', () => {
    const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });

    expect(() => store.issue(7, [])).toThrowError(
      expect.objectContaining({ code: KnowledgeBaseErrorCode.InvalidRequest }),
    );
    expect(() =>
      store.issue(
        7,
        Array.from({ length: KNOWLEDGE_MAX_SELECTION_FILES + 1 }, (_, index) =>
          selected(`${index}.pdf`),
        ),
      ),
    ).toThrowError(expect.objectContaining({ code: KnowledgeBaseErrorCode.TooManyFiles }));
  });

  test('does not expose main-process paths in issued selection metadata', () => {
    const store = new KnowledgeSelectionTokenStore({ now: () => 1_000 });

    const issued = store.issue(7, [selected('a.pdf')]);

    expect(JSON.stringify(issued)).not.toContain('/private/');
    expect(issued.files).toEqual([
      expect.objectContaining({ displayName: 'a.pdf', fileSize: 10 }),
    ]);
  });
});

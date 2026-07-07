import { describe, expect, test } from 'vitest';

import {
  filterSessionSearchItems,
  getCoworkSearchEmptyStateKey,
  getCoworkSearchSectionLabel,
  getNextCoworkSearchSelectionIndex,
} from './CoworkSearchModal';

describe('CoworkSearchModal helpers', () => {
  test('labels query results with the current result count', () => {
    expect(getCoworkSearchSectionLabel({ hasQuery: true, resultCount: 7 })).toEqual({
      key: 'searchResultsWithCount',
      replacements: { count: '7' },
    });
  });

  test('uses recent task copy for empty recent history', () => {
    expect(getCoworkSearchSectionLabel({ hasQuery: false, resultCount: 0 })).toEqual({
      key: 'searchRecentTasks',
      replacements: {},
    });
    expect(getCoworkSearchEmptyStateKey({ hasQuery: false })).toBe('searchNoRecentTasks');
  });

  test('moves keyboard selection through results with wrapping', () => {
    expect(
      getNextCoworkSearchSelectionIndex({
        currentIndex: -1,
        resultCount: 3,
        key: 'ArrowDown',
      }),
    ).toBe(0);
    expect(
      getNextCoworkSearchSelectionIndex({
        currentIndex: 2,
        resultCount: 3,
        key: 'ArrowDown',
      }),
    ).toBe(0);
    expect(
      getNextCoworkSearchSelectionIndex({
        currentIndex: 0,
        resultCount: 3,
        key: 'ArrowUp',
      }),
    ).toBe(2);
    expect(
      getNextCoworkSearchSelectionIndex({
        currentIndex: 1,
        resultCount: 3,
        key: 'Home',
      }),
    ).toBe(0);
    expect(
      getNextCoworkSearchSelectionIndex({
        currentIndex: 1,
        resultCount: 3,
        key: 'End',
      }),
    ).toBe(2);
  });

  test('clears keyboard selection when there are no results', () => {
    expect(
      getNextCoworkSearchSelectionIndex({
        currentIndex: 0,
        resultCount: 0,
        key: 'ArrowDown',
      }),
    ).toBe(-1);
  });

  test('filters reusable session search items by title and metadata', () => {
    const items = [
      {
        id: 'workspace-chat-1',
        title: '安装 oh-my-claudecode skill',
        metaText: '2 条消息',
      },
      {
        id: 'workspace-chat-2',
        title: '使用 GitHub 插件',
        metaText: '4 条消息',
      },
    ];

    expect(filterSessionSearchItems(items, 'github').map(item => item.id)).toEqual([
      'workspace-chat-2',
    ]);
    expect(filterSessionSearchItems(items, '2 条').map(item => item.id)).toEqual([
      'workspace-chat-1',
    ]);
    expect(filterSessionSearchItems(items, '').map(item => item.id)).toEqual([
      'workspace-chat-1',
      'workspace-chat-2',
    ]);
  });
});

import { describe, expect, test } from 'vitest';

import {
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
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import type { RootState } from '../../store';
import { toggleActiveKit } from '../../store/slices/kitSlice';
import ActiveKitBadge from './ActiveKitBadge';

const dispatch = vi.fn();
type ActiveKitBadgeTestState = Pick<RootState, 'kit'>;

let state: ActiveKitBadgeTestState;

vi.mock('react-redux', () => ({
  useDispatch: () => dispatch,
  useSelector: (selector: (nextState: ActiveKitBadgeTestState) => unknown) => selector(state),
}));

const getBadgeButtons = (rendered: React.ReactNode): React.ReactElement[] => {
  if (!React.isValidElement(rendered)) return [];
  return React.Children.toArray(
    (rendered as React.ReactElement<{ children: React.ReactNode }>).props.children,
  ) as React.ReactElement[];
};

describe('ActiveKitBadge', () => {
  test('renders and removes an installed active kit whose marketplace metadata is unavailable', () => {
    const kitId = 'workspace-default-kit';
    state = {
      kit: {
        activeKitIds: [kitId],
        installedKits: {
          [kitId]: {
            id: kitId,
            version: '1.0.0',
            installedAt: 1,
            skills: { skillIds: [] },
            mcpServers: [],
            connectors: [],
          },
        },
        marketplaceKits: [],
      },
    };

    const rendered = ActiveKitBadge({});
    const badgeButtons = getBadgeButtons(rendered);

    expect(renderToStaticMarkup(rendered)).toContain(kitId);
    expect(badgeButtons).toHaveLength(1);

    badgeButtons[0].props.onClick({ stopPropagation: vi.fn() });

    expect(dispatch).toHaveBeenCalledWith(toggleActiveKit(kitId));
  });
});

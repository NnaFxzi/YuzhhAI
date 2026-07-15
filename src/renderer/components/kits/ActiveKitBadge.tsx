import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { resolveLocalizedText } from '../../services/skill';
import { RootState } from '../../store';
import { toggleActiveKit } from '../../store/slices/kitSlice';
import {
  ACTIVE_CONTEXT_BADGE_BUTTON_CLASS,
  ACTIVE_CONTEXT_BADGE_ICON_CLASS,
  ACTIVE_CONTEXT_BADGE_ICON_WRAP_CLASS,
  ACTIVE_CONTEXT_BADGE_REMOVE_ICON_CLASS,
} from '../common/activeContextBadgeStyles';
import SidebarKitsIcon from '../icons/SidebarKitsIcon';
import XMarkIcon from '../icons/XMarkIcon';

const ActiveKitBadge: React.FC = () => {
  const dispatch = useDispatch();
  const activeKitIds = useSelector((state: RootState) => state.kit.activeKitIds);
  const installedKits = useSelector((state: RootState) => state.kit.installedKits);
  const marketplaceKits = useSelector((state: RootState) => state.kit.marketplaceKits);

  const activeKits = activeKitIds
    .map(id => {
      const marketplaceKit = marketplaceKits.find(kit => kit.id === id);
      if (!marketplaceKit && !installedKits[id]) return undefined;

      return {
        id,
        name: marketplaceKit ? resolveLocalizedText(marketplaceKit.name) : id,
      };
    })
    .filter((kit): kit is NonNullable<typeof kit> => kit !== undefined);

  if (activeKits.length === 0) return null;

  const handleRemoveKit = (e: React.MouseEvent, kitId: string) => {
    e.stopPropagation();
    dispatch(toggleActiveKit(kitId));
  };

  return (
    <>
      {activeKits.map(kit => (
        <button
          type="button"
          key={kit.id}
          onClick={(e) => handleRemoveKit(e, kit.id)}
          className={ACTIVE_CONTEXT_BADGE_BUTTON_CLASS}
          title={i18nService.t('clearKit')}
        >
          <span className={ACTIVE_CONTEXT_BADGE_ICON_WRAP_CLASS}>
            <SidebarKitsIcon className={ACTIVE_CONTEXT_BADGE_ICON_CLASS} />
            <XMarkIcon className={ACTIVE_CONTEXT_BADGE_REMOVE_ICON_CLASS} />
          </span>
          <span className="min-w-0 truncate">{kit.name}</span>
        </button>
      ))}
    </>
  );
};

export default ActiveKitBadge;

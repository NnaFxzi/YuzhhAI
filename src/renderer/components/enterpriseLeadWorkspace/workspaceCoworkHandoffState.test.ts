import { describe, expect, test, vi } from 'vitest';

import {
  setDraftCollaborationMode,
  setDraftKitIds,
  setDraftPrompt,
  setDraftSkillIds,
} from '../../store/slices/coworkSlice';
import { setActiveKitIds } from '../../store/slices/kitSlice';
import { clearActiveSkills } from '../../store/slices/skillSlice';
import { CoworkCollaborationMode } from '../../types/cowork';
import {
  discardEnterpriseLeadCoworkHandoffDraft,
  discardEnterpriseLeadCoworkHandoffDraftWhenLeavingForGlobalCowork,
  resetEnterpriseLeadCoworkHandoffDraft,
} from './workspaceCoworkHandoffState';

describe('resetEnterpriseLeadCoworkHandoffDraft', () => {
  test('clears skill and kit state before preparing enterprise Cowork chat', () => {
    const dispatch = vi.fn();

    resetEnterpriseLeadCoworkHandoffDraft(dispatch, 'hello');

    expect(dispatch).toHaveBeenCalledWith(setActiveKitIds([]));
    expect(dispatch).toHaveBeenCalledWith(clearActiveSkills());
    expect(dispatch).toHaveBeenCalledWith(
      setDraftCollaborationMode({
        draftKey: '__home__',
        mode: CoworkCollaborationMode.Default,
      }),
    );
    expect(dispatch).toHaveBeenCalledWith(
      setDraftPrompt({ sessionId: '__home__', draft: 'hello' }),
    );
    expect(dispatch).toHaveBeenCalledWith(setDraftKitIds({ draftKey: '__home__', kitIds: [] }));
    expect(dispatch).toHaveBeenCalledWith(setDraftSkillIds({ draftKey: '__home__', skillIds: [] }));
  });

  test('seeds workspace default Kits in the active and home draft selections', () => {
    const dispatch = vi.fn();

    resetEnterpriseLeadCoworkHandoffDraft(dispatch, 'hello', ['research', 'content']);

    expect(dispatch).toHaveBeenCalledWith(setActiveKitIds(['research', 'content']));
    expect(dispatch).toHaveBeenCalledWith(
      setDraftKitIds({ draftKey: '__home__', kitIds: ['research', 'content'] }),
    );
  });

  test('discards only the abandoned home selection when an existing session is active', () => {
    const dispatch = vi.fn();

    discardEnterpriseLeadCoworkHandoffDraft(dispatch, true);

    expect(dispatch).not.toHaveBeenCalledWith(setActiveKitIds([]));
    expect(dispatch).toHaveBeenCalledWith(
      setDraftKitIds({ draftKey: '__home__', kitIds: [] }),
    );
  });

  test('cleans workspace defaults only when navigating from the workspace to global Cowork', () => {
    const dispatch = vi.fn();

    discardEnterpriseLeadCoworkHandoffDraftWhenLeavingForGlobalCowork(dispatch, 'cowork');

    expect(dispatch).not.toHaveBeenCalled();

    discardEnterpriseLeadCoworkHandoffDraftWhenLeavingForGlobalCowork(
      dispatch,
      'enterpriseLeadWorkspace',
    );

    expect(dispatch).toHaveBeenCalledWith(setActiveKitIds([]));
    expect(dispatch).toHaveBeenCalledWith(
      setDraftKitIds({ draftKey: '__home__', kitIds: [] }),
    );
  });
});

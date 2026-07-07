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
import { resetEnterpriseLeadCoworkHandoffDraft } from './workspaceCoworkHandoffState';

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
});

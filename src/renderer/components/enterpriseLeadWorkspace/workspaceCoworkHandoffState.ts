import {
  setDraftCollaborationMode,
  setDraftKitIds,
  setDraftPrompt,
  setDraftSkillIds,
} from '../../store/slices/coworkSlice';
import { setActiveKitIds } from '../../store/slices/kitSlice';
import { clearActiveSkills } from '../../store/slices/skillSlice';
import { CoworkCollaborationMode } from '../../types/cowork';

export const ENTERPRISE_LEAD_COWORK_HOME_DRAFT_KEY = '__home__';

type EnterpriseLeadCoworkHandoffAction =
  | ReturnType<typeof setActiveKitIds>
  | ReturnType<typeof clearActiveSkills>
  | ReturnType<typeof setDraftCollaborationMode>
  | ReturnType<typeof setDraftPrompt>
  | ReturnType<typeof setDraftKitIds>
  | ReturnType<typeof setDraftSkillIds>;

type EnterpriseLeadCoworkHandoffDispatch = (action: EnterpriseLeadCoworkHandoffAction) => void;

export const resetEnterpriseLeadCoworkHandoffDraft = (
  dispatch: EnterpriseLeadCoworkHandoffDispatch,
  draft: string,
  kitIds: string[] = [],
): void => {
  dispatch(setActiveKitIds(kitIds));
  dispatch(clearActiveSkills());
  dispatch(
    setDraftCollaborationMode({
      draftKey: ENTERPRISE_LEAD_COWORK_HOME_DRAFT_KEY,
      mode: CoworkCollaborationMode.Default,
    }),
  );
  dispatch(setDraftPrompt({ sessionId: ENTERPRISE_LEAD_COWORK_HOME_DRAFT_KEY, draft }));
  dispatch(setDraftKitIds({ draftKey: ENTERPRISE_LEAD_COWORK_HOME_DRAFT_KEY, kitIds }));
  dispatch(setDraftSkillIds({ draftKey: ENTERPRISE_LEAD_COWORK_HOME_DRAFT_KEY, skillIds: [] }));
};

export const discardEnterpriseLeadCoworkHandoffDraft = (
  dispatch: EnterpriseLeadCoworkHandoffDispatch,
  preserveActiveKitIds: boolean,
): void => {
  if (!preserveActiveKitIds) {
    dispatch(setActiveKitIds([]));
  }
  dispatch(setDraftKitIds({ draftKey: ENTERPRISE_LEAD_COWORK_HOME_DRAFT_KEY, kitIds: [] }));
};

export const discardEnterpriseLeadCoworkHandoffDraftWhenLeavingForGlobalCowork = (
  dispatch: EnterpriseLeadCoworkHandoffDispatch,
  previousMainView: string,
): void => {
  if (previousMainView === 'enterpriseLeadWorkspace') {
    discardEnterpriseLeadCoworkHandoffDraft(dispatch, false);
  }
};

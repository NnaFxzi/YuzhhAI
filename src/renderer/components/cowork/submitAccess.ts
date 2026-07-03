import { ProviderName } from '@shared/providers';

import type { Model } from '../../store/slices/modelSlice';
import { ModelAccessPromptKind } from '../ModelSelector';

function isAccessibleCustomModel(model: Model | null): boolean {
  return !!model
    && model.providerKey !== ProviderName.LobsteraiServer
    && model.isServerModel !== true
    && model.accessible !== false;
}

export function resolveCoworkSubmitAccessPrompt({
  isLoggedIn,
  effectiveSelectedModel,
}: {
  isLoggedIn: boolean;
  effectiveSelectedModel: Model | null;
}): ModelAccessPromptKind | null {
  if (!isLoggedIn) {
    return isAccessibleCustomModel(effectiveSelectedModel)
      ? null
      : ModelAccessPromptKind.Login;
  }
  if (
    effectiveSelectedModel?.providerKey === ProviderName.LobsteraiServer
    && effectiveSelectedModel.accessible === false
  ) {
    return ModelAccessPromptKind.Subscribe;
  }
  return null;
}

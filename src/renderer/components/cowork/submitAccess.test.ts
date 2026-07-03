import { ProviderName } from '@shared/providers';
import { expect, test } from 'vitest';

import { ModelAccessPromptKind } from '../ModelSelector';
import { resolveCoworkSubmitAccessPrompt } from './submitAccess';

test('allows anonymous submit when an accessible custom model is selected', () => {
  const prompt = resolveCoworkSubmitAccessPrompt({
    isLoggedIn: false,
    effectiveSelectedModel: {
      id: 'qwen3.6-plus',
      name: 'Qwen3.6 Plus',
      providerKey: 'custom_0',
    },
  });

  expect(prompt).toBeNull();
});

test('requires login before submitting without an accessible custom model', () => {
  const prompt = resolveCoworkSubmitAccessPrompt({
    isLoggedIn: false,
    effectiveSelectedModel: null,
  });

  expect(prompt).toBe(ModelAccessPromptKind.Login);
});

test('requires subscription for inaccessible server models after login', () => {
  const prompt = resolveCoworkSubmitAccessPrompt({
    isLoggedIn: true,
    effectiveSelectedModel: {
      id: 'server-model',
      name: 'Server Model',
      providerKey: ProviderName.LobsteraiServer,
      isServerModel: true,
      accessible: false,
    },
  });

  expect(prompt).toBe(ModelAccessPromptKind.Subscribe);
});

test('allows logged-in users to submit with accessible custom models', () => {
  const prompt = resolveCoworkSubmitAccessPrompt({
    isLoggedIn: true,
    effectiveSelectedModel: {
      id: 'qwen3.6-plus',
      name: 'Qwen3.6 Plus',
      providerKey: 'custom_0',
    },
  });

  expect(prompt).toBeNull();
});

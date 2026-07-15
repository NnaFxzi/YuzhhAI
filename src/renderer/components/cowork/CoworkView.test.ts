import { configureStore } from '@reduxjs/toolkit';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { coworkService } from '../../services/cowork';
import { kitService } from '../../services/kit';
import { quickActionService } from '../../services/quickAction';
import agentReducer from '../../store/slices/agentSlice';
import coworkReducer, { setCurrentSession, setDraftKitIds } from '../../store/slices/coworkSlice';
import kitReducer, { setActiveKitIds, setMarketplaceKits } from '../../store/slices/kitSlice';
import modelReducer from '../../store/slices/modelSlice';
import quickActionReducer from '../../store/slices/quickActionSlice';
import skillReducer from '../../store/slices/skillSlice';
import type { CoworkSession } from '../../types/cowork';
import type { InstalledKit, MarketplaceKit } from '../../types/kit';
import { discardEnterpriseLeadCoworkHandoffDraft } from '../enterpriseLeadWorkspace/workspaceCoworkHandoffState';
import type { CoworkViewProps } from './CoworkView';

const captured = vi.hoisted(() => ({
  homeSubmit: null as ((prompt: string) => Promise<boolean | void>) | null,
  homeStop: null as (() => Promise<void>) | null,
  continueSubmit: null as ((prompt: string) => Promise<boolean>) | null,
  sessionStop: null as (() => void | Promise<void>) | null,
}));

const stateOverrides = vi.hoisted(() => ({
  forceInitialized: false,
  collectEffects: false,
  effects: [] as Array<() => void | (() => void)>,
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initialValue: unknown) => {
      const state = actual.useState(initialValue);
      if (stateOverrides.forceInitialized && initialValue === false) {
        stateOverrides.forceInitialized = false;
        return [true, state[1]];
      }
      return state;
    },
    useEffect: (effect: () => void | (() => void)) => {
      if (stateOverrides.collectEffects) {
        stateOverrides.effects.push(effect);
      }
    },
  };
});

vi.mock('./CoworkPromptInput', async () => {
  const ReactInner = await import('react');
  return {
    default: ReactInner.forwardRef(
      (
        props: {
          onSubmit: (prompt: string) => Promise<boolean | void>;
          onStop: () => Promise<void>;
        },
        _ref,
      ) => {
        captured.homeSubmit = props.onSubmit;
        captured.homeStop = props.onStop;
        return ReactInner.createElement('div');
      },
    ),
  };
});

vi.mock('./CoworkSessionDetail', () => ({
  default: (props: {
    onContinue: (prompt: string) => Promise<boolean>;
    onStop: () => void | Promise<void>;
  }) => {
    captured.continueSubmit = props.onContinue;
    captured.sessionStop = props.onStop;
    return React.createElement('div');
  },
}));

vi.mock('../CreditsResetCampaignFloat', () => ({ default: () => null }));
vi.mock('../quick-actions', () => ({ PromptPanel: () => null }));
vi.mock('../window/WindowTitleBar', () => ({ default: () => null }));
vi.mock('../workbench', () => ({ WorkbenchWorkflowGrid: () => null }));

import CoworkView from './CoworkView';

const createSession = (id: string): CoworkSession => ({
  id,
  title: id,
  claudeSessionId: null,
  status: 'idle',
  pinned: false,
  cwd: '',
  systemPrompt: '',
  modelOverride: '',
  executionMode: 'local',
  activeSkillIds: [],
  agentId: 'main',
  messages: [],
  messagesOffset: 0,
  totalMessages: 0,
  createdAt: 1,
  updatedAt: 1,
});

const createWorkspace = (): EnterpriseLeadWorkspace =>
  ({
    id: 'workspace-1',
    settings: { kitIds: ['research', 'content'] },
  }) as EnterpriseLeadWorkspace;

const loadedMarketplaceKit: MarketplaceKit = {
  id: 'research',
  name: 'Research',
  description: 'Research workflows',
};

const loadedInstalledKit: InstalledKit = {
  id: 'research',
  version: '1.0.0',
  installedAt: 1,
  skills: { skillIds: ['web-search'] },
  mcpServers: [{ id: 'search-mcp' }],
  connectors: [{ id: 'search-connector' }],
};

const createStore = () =>
  configureStore({
    reducer: {
      agent: agentReducer,
      cowork: coworkReducer,
      kit: kitReducer,
      model: modelReducer,
      quickAction: quickActionReducer,
      skill: skillReducer,
    },
  });

const renderCoworkView = (
  store: ReturnType<typeof createStore>,
  props: CoworkViewProps = {},
  collectEffects = false,
): Array<() => void | (() => void)> => {
  stateOverrides.forceInitialized = true;
  stateOverrides.collectEffects = collectEffects;
  stateOverrides.effects = [];
  renderToStaticMarkup(
    React.createElement(Provider, {
      store,
      children: React.createElement(CoworkView, props),
    }),
  );
  stateOverrides.collectEffects = false;
  return stateOverrides.effects;
};

describe('CoworkView workspace default kits', () => {
  beforeEach(() => {
    captured.homeSubmit = null;
    captured.homeStop = null;
    captured.continueSubmit = null;
    captured.sessionStop = null;
    vi.stubGlobal('window', {
      electron: {
        platform: 'darwin',
        log: { fromRenderer: vi.fn() },
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    vi.spyOn(coworkService, 'checkApiConfig').mockResolvedValue(null);
    vi.spyOn(coworkService, 'init').mockResolvedValue();
    vi.spyOn(coworkService, 'getOpenClawEngineStatus').mockResolvedValue(null);
    vi.spyOn(coworkService, 'onOpenClawEngineStatus').mockReturnValue(vi.fn());
    vi.spyOn(coworkService, 'startSession').mockResolvedValue({
      session: createSession('started-session'),
    });
    vi.spyOn(coworkService, 'continueSession').mockResolvedValue(true);
    vi.spyOn(coworkService, 'stopSession').mockResolvedValue();
    vi.spyOn(kitService, 'fetchMarketplaceKits').mockResolvedValue([]);
    vi.spyOn(kitService, 'getInstalledKits').mockResolvedValue({});
    vi.spyOn(quickActionService, 'initialize').mockImplementation(() => undefined);
    vi.spyOn(quickActionService, 'getLocalizedActions').mockResolvedValue([]);
    vi.spyOn(quickActionService, 'subscribe').mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('starts an embedded session with defaults first in the request and session snapshot', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research', 'content', 'risk']));
    store.dispatch(
      setMarketplaceKits([
        { id: 'research', name: 'Research', description: '' },
        { id: 'content', name: 'Content', description: '' },
        { id: 'risk', name: 'Risk', description: '' },
      ]),
    );

    renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() });

    await captured.homeSubmit?.('Plan the launch');

    const expectedKitSnapshot = {
      kitIds: ['research', 'content', 'risk'],
      kitReferences: [
        expect.objectContaining({ id: 'research' }),
        expect.objectContaining({ id: 'content' }),
        expect.objectContaining({ id: 'risk' }),
      ],
      resolvedKitCapabilities: {
        skillIds: [],
        mcpServers: [],
        connectors: [],
      },
    };

    expect(coworkService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        ...expectedKitSnapshot,
        workspaceId: 'workspace-1',
      }),
    );
    expect(store.getState().cowork.currentSession?.activeKitIds).toEqual([
      'research',
      'content',
      'risk',
    ]);
    expect(store.getState().cowork.currentSession?.messages[0].metadata).toMatchObject(
      expectedKitSnapshot,
    );
  });

  test('loads a workspace default Kit before the first chat resolves its capabilities', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research']));
    vi.spyOn(kitService, 'fetchMarketplaceKits').mockResolvedValue([loadedMarketplaceKit]);
    vi.spyOn(kitService, 'getInstalledKits').mockResolvedValue({
      research: loadedInstalledKit,
    });

    const effects = renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() }, true);
    effects[2]?.();

    await vi.waitFor(() => {
      expect(store.getState().kit).toMatchObject({
        installedKits: { research: loadedInstalledKit },
        marketplaceKits: [loadedMarketplaceKit],
      });
    });

    renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() });
    await captured.homeSubmit?.('Research the launch');

    expect(coworkService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kitIds: ['research'],
        kitReferences: [expect.objectContaining({ id: 'research', name: 'Research' })],
        resolvedKitCapabilities: {
          skillIds: ['web-search'],
          mcpServers: [{ id: 'search-mcp' }],
          connectors: [{ id: 'search-connector' }],
        },
        workspaceId: 'workspace-1',
      }),
    );
  });

  test('awaits Kit preload before an immediate workspace chat resolves capabilities', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research']));
    let resolveMarketplaceKits: (kits: MarketplaceKit[]) => void;
    let resolveInstalledKits: (kits: Record<string, InstalledKit>) => void;
    const marketplaceKits = new Promise<MarketplaceKit[]>(resolve => {
      resolveMarketplaceKits = resolve;
    });
    const installedKits = new Promise<Record<string, InstalledKit>>(resolve => {
      resolveInstalledKits = resolve;
    });
    vi.mocked(kitService.fetchMarketplaceKits).mockReturnValue(marketplaceKits);
    vi.mocked(kitService.getInstalledKits).mockReturnValue(installedKits);

    const effects = renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() }, true);
    effects[2]?.();

    const submitPromise = captured.homeSubmit?.('Research the launch');
    expect(coworkService.startSession).not.toHaveBeenCalled();

    resolveMarketplaceKits!([loadedMarketplaceKit]);
    resolveInstalledKits!({ research: loadedInstalledKit });
    await submitPromise;

    expect(kitService.fetchMarketplaceKits).toHaveBeenCalledTimes(1);
    expect(kitService.getInstalledKits).toHaveBeenCalledTimes(1);
    expect(coworkService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kitIds: ['research'],
        kitReferences: [expect.objectContaining({ id: 'research', name: 'Research' })],
        resolvedKitCapabilities: {
          skillIds: ['web-search'],
          mcpServers: [{ id: 'search-mcp' }],
          connectors: [{ id: 'search-connector' }],
        },
        workspaceId: 'workspace-1',
      }),
    );
  });

  test('does not start a session when stopped during Kit preload', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research']));
    const marketplaceKits = new Promise<MarketplaceKit[]>(() => undefined);
    const installedKits = new Promise<Record<string, InstalledKit>>(() => undefined);
    vi.mocked(kitService.fetchMarketplaceKits).mockReturnValue(marketplaceKits);
    vi.mocked(kitService.getInstalledKits).mockReturnValue(installedKits);

    renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() });

    const submitPromise = captured.homeSubmit!('Research the launch');
    await vi.waitFor(() => {
      expect(kitService.fetchMarketplaceKits).toHaveBeenCalledTimes(1);
      expect(kitService.getInstalledKits).toHaveBeenCalledTimes(1);
    });
    await captured.homeStop?.();

    await expect(submitPromise).resolves.toBe(false);

    expect(coworkService.startSession).not.toHaveBeenCalled();
    expect(store.getState().cowork.currentSession).toBeNull();
    expect(store.getState().cowork.isStreaming).toBe(false);
    expect(store.getState().kit.activeKitIds).toEqual(['research']);
  });

  test('does not start or commit a session when unmounted during Kit preload', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research']));
    const marketplaceKits = new Promise<MarketplaceKit[]>(() => undefined);
    const installedKits = new Promise<Record<string, InstalledKit>>(() => undefined);
    vi.mocked(kitService.fetchMarketplaceKits).mockReturnValue(marketplaceKits);
    vi.mocked(kitService.getInstalledKits).mockReturnValue(installedKits);

    const effects = renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() }, true);

    const submitPromise = captured.homeSubmit!('Research the launch');
    await vi.waitFor(() => {
      expect(kitService.fetchMarketplaceKits).toHaveBeenCalledTimes(1);
      expect(kitService.getInstalledKits).toHaveBeenCalledTimes(1);
    });
    const unmount = effects[3]?.();
    if (typeof unmount === 'function') {
      unmount();
    }

    await expect(submitPromise).resolves.toBe(false);

    expect(coworkService.startSession).not.toHaveBeenCalled();
    expect(store.getState().cowork.currentSession).toBeNull();
    expect(store.getState().cowork.isStreaming).toBe(false);
    expect(store.getState().kit.activeKitIds).toEqual(['research']);
  });

  test('omits a seeded workspace default Kit removed before starting the session', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research', 'content']));
    store.dispatch(setDraftKitIds({ draftKey: '__home__', kitIds: ['research', 'content'] }));
    store.dispatch(setActiveKitIds(['content']));
    store.dispatch(setDraftKitIds({ draftKey: '__home__', kitIds: ['content'] }));
    store.dispatch(
      setMarketplaceKits([
        { id: 'research', name: 'Research', description: '' },
        { id: 'content', name: 'Content', description: '' },
      ]),
    );

    renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() });

    await captured.homeSubmit?.('Plan the launch');

    expect(coworkService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ kitIds: ['content'] }),
    );
    expect(store.getState().cowork.currentSession?.activeKitIds).toEqual(['content']);
    expect(store.getState().cowork.currentSession?.messages[0].metadata).toMatchObject({
      kitIds: ['content'],
    });
  });

  test('continues an existing embedded session with its own temporary Kit selection', async () => {
    const store = createStore();
    store.dispatch(setCurrentSession(createSession('existing-session')));
    store.dispatch(setActiveKitIds(['research', 'content']));
    store.dispatch(
      setDraftKitIds({ draftKey: '__home__', kitIds: ['research', 'content'] }),
    );
    store.dispatch(setDraftKitIds({ draftKey: 'existing-session', kitIds: ['temporary'] }));

    renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() });

    await captured.continueSubmit?.('Continue the plan');

    expect(coworkService.continueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        kitIds: ['temporary'],
        workspaceId: 'workspace-1',
      }),
    );
  });

  test('stops an existing embedded session after pre-session cancellation handling', async () => {
    const store = createStore();
    store.dispatch(setCurrentSession(createSession('existing-session')));

    renderCoworkView(store, { enterpriseLeadWorkspace: createWorkspace() });

    await captured.sessionStop?.();

    expect(coworkService.stopSession).toHaveBeenCalledWith('existing-session');
  });

  test('does not send carried workspace defaults when global Cowork starts a session', async () => {
    const store = createStore();
    store.dispatch(setActiveKitIds(['research', 'content']));
    store.dispatch(
      setDraftKitIds({ draftKey: '__home__', kitIds: ['research', 'content'] }),
    );

    discardEnterpriseLeadCoworkHandoffDraft(store.dispatch, false);
    store.dispatch(setActiveKitIds(['global-temporary']));
    store.dispatch(setDraftKitIds({ draftKey: '__home__', kitIds: ['global-temporary'] }));

    renderCoworkView(store);

    await captured.homeSubmit?.('Global task');

    expect(coworkService.startSession).toHaveBeenCalledWith(
      expect.objectContaining({ kitIds: ['global-temporary'] }),
    );
    expect(vi.mocked(coworkService.startSession).mock.calls[0]?.[0]).not.toHaveProperty(
      'workspaceId',
    );
  });
});

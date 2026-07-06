import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import React, { useMemo, useState } from 'react';

import type {
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceChatSessionSummary,
} from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';

interface WorkspaceSearchProps {
  workspace: EnterpriseLeadWorkspace;
  chatSessions?: EnterpriseLeadWorkspaceChatSessionSummary[];
  onChatSessionSelect?: (sessionId: string) => void;
}

export interface WorkspaceSearchResult {
  id: string;
  areaLabelKey: string;
  title: string;
  description: string;
  targetChatSessionId?: string;
}

const normalizeSearchText = (value: string): string =>
  value.trim().toLocaleLowerCase();

const matchesQuery = (query: string, values: string[]): boolean => {
  if (!query) {
    return true;
  }

  return values.some(value => normalizeSearchText(value).includes(query));
};

const compactText = (values: Array<string | undefined>): string =>
  values
    .map(value => value?.trim() ?? '')
    .filter(Boolean)
    .join(' / ');

const appendTextResults = (
  results: WorkspaceSearchResult[],
  query: string,
  areaLabelKey: string,
  idPrefix: string,
  values: string[],
): void => {
  values
    .map(value => value.trim())
    .filter(Boolean)
    .forEach((value, index) => {
      if (!matchesQuery(query, [value, areaLabelKey])) {
        return;
      }

      results.push({
        id: `${idPrefix}-${index}`,
        areaLabelKey,
        title: value,
        description: i18nService.t('enterpriseLeadWorkspaceSearchProfileResultDescription'),
      });
    });
};

const appendChatSessionResults = (
  results: WorkspaceSearchResult[],
  query: string,
  chatSessions: EnterpriseLeadWorkspaceChatSessionSummary[],
): void => {
  chatSessions.forEach((session) => {
    const title = session.title.trim() || i18nService.t('enterpriseLeadAiChatUntitledSession');
    if (!matchesQuery(query, [title])) {
      return;
    }

    results.push({
      id: `chat-${session.id}`,
      areaLabelKey: 'enterpriseLeadWorkspaceSearchAreaConversations',
      title,
      description: i18nService
        .t('enterpriseLeadWorkspaceSearchConversationDescription')
        .replace('{count}', String(session.messageCount)),
      targetChatSessionId: session.id,
    });
  });
};

export const buildWorkspaceSearchResults = (
  workspace: EnterpriseLeadWorkspace,
  rawQuery: string,
  chatSessions: EnterpriseLeadWorkspaceChatSessionSummary[] = [],
): WorkspaceSearchResult[] => {
  const query = normalizeSearchText(rawQuery);
  const results: WorkspaceSearchResult[] = [];
  const { profile } = workspace;
  appendChatSessionResults(results, query, chatSessions);

  if (!query && chatSessions.length > 0) {
    return results;
  }

  if (matchesQuery(query, [workspace.name, profile.companySummary])) {
    results.push({
      id: 'workspace-profile',
      areaLabelKey: 'enterpriseLeadWorkspaceSearchAreaWorkspace',
      title: workspace.name,
      description: profile.companySummary || i18nService.t('enterpriseLeadWorkspaceSearchWorkspaceFallback'),
    });
  }

  appendTextResults(
    results,
    query,
    'enterpriseLeadWorkspaceSearchAreaKnowledge',
    'product',
    [
      ...profile.productList,
      ...profile.productCapabilities,
      ...profile.targetCustomers,
      ...profile.applicationScenarios,
      ...profile.sellingPoints,
      ...profile.channelPreferences,
    ],
  );

  appendTextResults(
    results,
    query,
    'enterpriseLeadWorkspaceSearchAreaRules',
    'rule',
    [
      ...profile.prohibitedClaims,
      ...profile.contactRules,
      ...profile.missingInfo,
      ...workspace.riskRules,
    ],
  );

  workspace.extractionSources.forEach((source, index) => {
    const description = compactText([source.text, source.filePath, source.kind]);
    if (!matchesQuery(query, [source.label, description])) {
      return;
    }

    results.push({
      id: `source-${index}`,
      areaLabelKey: 'enterpriseLeadWorkspaceSearchAreaSources',
      title: source.label,
      description: description || i18nService.t('enterpriseLeadWorkspaceSearchSourceFallback'),
    });
  });

  workspace.workspaceAgents.forEach(agent => {
    const title = agent.overrides.name || agent.name || agent.agentId;
    const description = compactText([
      agent.overrides.description,
      agent.description,
      agent.overrides.identity,
      agent.identity,
      agent.overrides.systemPrompt,
      agent.systemPrompt,
      agent.overrides.model,
      agent.model,
    ]);

    if (!matchesQuery(query, [title, description])) {
      return;
    }

    results.push({
      id: `agent-${agent.agentId}`,
      areaLabelKey: 'enterpriseLeadWorkspaceSearchAreaAgents',
      title,
      description: description || i18nService.t('enterpriseLeadWorkspaceSearchAgentFallback'),
    });
  });

  return results;
};

export const WorkspaceSearch: React.FC<WorkspaceSearchProps> = ({
  workspace,
  chatSessions = [],
  onChatSessionSelect,
}) => {
  const [query, setQuery] = useState('');
  const results = useMemo(
    () => buildWorkspaceSearchResults(workspace, query, chatSessions),
    [chatSessions, query, workspace],
  );
  const resultCountText = i18nService
    .t('enterpriseLeadWorkspaceSearchResultCount')
    .replace('{count}', String(results.length));

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-8">
        <header className="shrink-0">
          <h1 className="text-2xl font-semibold text-foreground">
            {i18nService.t('enterpriseLeadWorkbenchNavSearch')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary">
            {i18nService.t('enterpriseLeadWorkspaceSearchDescription')}
          </p>
        </header>

        <div className="relative mt-6">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
          <input
            type="search"
            value={query}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setQuery(event.target.value)}
            aria-label={i18nService.t('enterpriseLeadWorkspaceSearchInputLabel')}
            placeholder={i18nService.t('enterpriseLeadWorkspaceSearchPlaceholder')}
            className="h-11 w-full rounded-lg border border-border bg-surface px-9 text-sm text-foreground outline-none transition-colors placeholder:text-tertiary focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 text-xs text-secondary">
          <span>{resultCountText}</span>
          <span className="truncate">
            {i18nService.t('enterpriseLeadWorkspaceSearchScope')}
          </span>
        </div>

        {results.length > 0 ? (
          <ul className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface">
            {results.map(result => {
              const content = (
                <>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="rounded-md bg-surface-raised px-2 py-0.5 text-[11px] font-medium text-secondary">
                      {i18nService.t(result.areaLabelKey)}
                    </span>
                    <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {result.title}
                    </h2>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm leading-6 text-secondary">
                    {result.description}
                  </p>
                </>
              );

              return (
                <li key={result.id}>
                  {result.targetChatSessionId ? (
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-surface-raised"
                      onClick={() => onChatSessionSelect?.(result.targetChatSessionId!)}
                    >
                      {content}
                    </button>
                  ) : (
                    <div className="px-4 py-3">
                      {content}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="mt-4 rounded-lg border border-dashed border-border bg-surface px-4 py-8 text-center text-sm text-secondary">
            {i18nService.t('enterpriseLeadWorkspaceSearchEmpty')}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceSearch;

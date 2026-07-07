import type { EnterpriseLeadWorkspaceChatSessionSummary } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import type { CoworkSessionSummary } from '../../types/cowork';

export const mapCoworkSessionsToEnterpriseLeadChatSessionSummaries = (
  sessions: CoworkSessionSummary[],
  workspaceId: string,
): EnterpriseLeadWorkspaceChatSessionSummary[] =>
  sessions.map(session => ({
    id: session.id,
    workspaceId,
    title: session.title.trim() || i18nService.t('enterpriseLeadAiChatUntitledSession'),
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    messageCount: 0,
  }));

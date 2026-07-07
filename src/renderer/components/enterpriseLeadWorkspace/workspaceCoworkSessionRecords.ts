import { i18nService } from '../../services/i18n';
import type { CoworkSessionSummary } from '../../types/cowork';

export interface WorkspaceConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export const mapCoworkSessionsToWorkspaceConversationRecords = (
  sessions: CoworkSessionSummary[],
): WorkspaceConversationRecord[] =>
  sessions.map(session => ({
    id: session.id,
    title: session.title.trim() || i18nService.t('enterpriseLeadWorkspaceConversationUntitled'),
    createdAt: new Date(session.createdAt).toISOString(),
    updatedAt: new Date(session.updatedAt).toISOString(),
    messageCount: 0,
  }));

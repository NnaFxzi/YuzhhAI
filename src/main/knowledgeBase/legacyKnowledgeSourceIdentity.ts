import crypto from 'node:crypto';

import type { EnterpriseLeadExtractionSource } from '../../shared/enterpriseLeadWorkspace/types';
import { KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX } from '../../shared/knowledgeBase/constants';

export const isNormalizedKnowledgeProjectionSourceId = (sourceId?: string): boolean =>
  sourceId?.trim().startsWith(KNOWLEDGE_DOCUMENT_LEGACY_SOURCE_PREFIX) ?? false;

export const buildLegacyKnowledgeSourceId = (
  workspaceId: string,
  source: EnterpriseLeadExtractionSource,
  sourceIndex: number,
): string => {
  const existingId = source.id?.trim();
  if (existingId) {
    return existingId;
  }
  return crypto
    .createHash('sha256')
    .update(workspaceId.trim())
    .update('\0')
    .update(String(sourceIndex))
    .update('\0')
    .update(source.label ?? '')
    .update('\0')
    .update(source.filePath ?? '')
    .update('\0')
    .update(source.createdAt ?? '')
    .digest('hex');
};

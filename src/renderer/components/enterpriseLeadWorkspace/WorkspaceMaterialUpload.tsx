import { ArrowUpTrayIcon, DocumentIcon, PhotoIcon, TableCellsIcon, XMarkIcon, } from '@heroicons/react/24/outline';
import React, { useCallback, useRef } from 'react';

import {
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import { KNOWLEDGE_MAX_SELECTION_FILES, KnowledgeBaseErrorCode, } from '../../../shared/knowledgeBase/constants';
import type { KnowledgeFileSelection } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import { knowledgeBaseService, KnowledgeBaseServiceError } from '../../services/knowledgeBase';
import { getKnowledgeDocumentErrorKey } from './knowledgeDocumentPresentation';
import type { WorkspaceMaterialSelectionItem } from './workspaceCreationKnowledgeImport';

export interface WorkspaceMaterialUploadProps {
  items: WorkspaceMaterialSelectionItem[];
  onItemsChange: (items: WorkspaceMaterialSelectionItem[]) => void;
  onError: (messages: string[]) => void;
  disabled?: boolean;
}

export interface WorkspaceMaterialSelectionMergeResult {
  items: WorkspaceMaterialSelectionItem[];
  limitExceeded: boolean;
}

const t = (key: string, params?: Record<string, string>): string => {
  const raw = i18nService.t(key);
  if (!params) {
    return raw;
  }
  return Object.entries(params).reduce(
    (result, [name, value]) => result.replace(`{${name}}`, value),
    raw,
  );
};

const READABLE_EXTENSIONS = new Set<string>(EnterpriseLeadReadableDocumentExtensions);
const IMAGE_EXTENSIONS = new Set<string>(EnterpriseLeadImageAttachmentExtensions);

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '';
  }
  if (bytes < 1_024) {
    return `${bytes} B`;
  }
  if (bytes < 1_024 * 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KB`;
  }
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
};

const getExtension = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

const getFileIcon = (item: WorkspaceMaterialSelectionItem): React.ReactNode => {
  const extension = getExtension(item.displayName);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return <PhotoIcon className="h-4 w-4" />;
  }
  if (READABLE_EXTENSIONS.has(extension) && /^(xlsx?|csv|tsv)$/.test(extension)) {
    return <TableCellsIcon className="h-4 w-4" />;
  }
  return <DocumentIcon className="h-4 w-4" />;
};

export const mergeWorkspaceMaterialSelection = (
  currentItems: WorkspaceMaterialSelectionItem[],
  selection: KnowledgeFileSelection | null,
): WorkspaceMaterialSelectionMergeResult => {
  if (!selection) {
    return { items: currentItems, limitExceeded: false };
  }
  if (currentItems.length + selection.files.length > KNOWLEDGE_MAX_SELECTION_FILES) {
    return { items: currentItems, limitExceeded: true };
  }
  return {
    items: [
      ...currentItems,
      ...selection.files.map(file => ({
        itemId: file.itemId,
        displayName: file.displayName,
        fileSize: file.fileSize,
        selectionToken: selection.selectionToken,
      })),
    ],
    limitExceeded: false,
  };
};

const getSelectionErrorCode = (error: unknown): KnowledgeBaseErrorCode =>
  error instanceof KnowledgeBaseServiceError
    ? error.code
    : KnowledgeBaseErrorCode.PersistenceFailed;

export const WorkspaceMaterialUpload: React.FC<WorkspaceMaterialUploadProps> = ({
  items,
  onItemsChange,
  onError,
  disabled = false,
}) => {
  const requestIdRef = useRef(0);

  const handleChooseClick = useCallback((): void => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    void knowledgeBaseService
      .selectFiles()
      .then(selection => {
        if (requestId !== requestIdRef.current || !selection) {
          return;
        }
        const merged = mergeWorkspaceMaterialSelection(items, selection);
        if (merged.limitExceeded) {
          onError([
            i18nService.t(getKnowledgeDocumentErrorKey(KnowledgeBaseErrorCode.TooManyFiles)),
          ]);
          return;
        }
        onError([]);
        onItemsChange(merged.items);
      })
      .catch(error => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        onError([i18nService.t(getKnowledgeDocumentErrorKey(getSelectionErrorCode(error)))]);
      });
  }, [items, onError, onItemsChange]);

  const handleRemove = useCallback(
    (itemId: string): void => {
      onItemsChange(items.filter(item => item.itemId !== itemId));
    },
    [items, onItemsChange],
  );

  const listTitle =
    items.length === 0
      ? t('enterpriseLeadMaterialEmpty')
      : t('enterpriseLeadMaterialListTitle', { count: String(items.length) });

  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={handleChooseClick}
        disabled={disabled}
        className="grid min-h-[120px] w-full grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-5 py-4 text-left transition-colors hover:border-primary/70 hover:bg-primary/10 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-surface text-primary shadow-sm">
          <ArrowUpTrayIcon className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">{listTitle}</span>
          <span className="mt-1 block text-xs leading-5 text-secondary">
            {t('enterpriseLeadCreateMaterialDropDesc')}
          </span>
        </span>
        <span className="text-sm font-semibold text-primary">
          {t('enterpriseLeadCreateMaterialChooseFile')}
        </span>
      </button>

      {items.length > 0 ? (
        <ul className="grid gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
          {items.map(item => (
            <li
              key={item.itemId}
              className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs"
            >
              <span className="text-secondary">{getFileIcon(item)}</span>
              <span className="truncate text-foreground" title={item.displayName}>
                {item.displayName}
              </span>
              <span className="text-secondary">{formatBytes(item.fileSize)}</span>
              <button
                type="button"
                onClick={() => handleRemove(item.itemId)}
                disabled={disabled}
                aria-label={t('enterpriseLeadMaterialRemoveFile', { name: item.displayName })}
                className="grid h-6 w-6 place-items-center rounded text-secondary hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {items.length > 0 ? (
        <button
          type="button"
          onClick={handleChooseClick}
          disabled={disabled}
          className="self-start text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('enterpriseLeadMaterialAddMore')}
        </button>
      ) : null}
    </div>
  );
};

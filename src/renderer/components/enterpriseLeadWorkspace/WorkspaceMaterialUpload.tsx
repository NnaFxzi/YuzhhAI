import {
  ArrowUpTrayIcon,
  DocumentIcon,
  PhotoIcon,
  TableCellsIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useId, useMemo, useRef } from 'react';

import {
  EnterpriseLeadAttachmentOnlyDocumentExtensions,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import { i18nService } from '../../services/i18n';
import {
  ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS,
  ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS,
  type MaterialUploadItem,
  MAX_MATERIAL_UPLOAD_BYTES,
} from './enterpriseLeadWorkspaceUi';

interface WorkspaceMaterialUploadProps {
  items: MaterialUploadItem[];
  onItemsChange: (items: MaterialUploadItem[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}

type DialogFileFilter = { name: string; extensions: string[] };

type RejectReason = 'oversize' | 'unsupported' | 'read';

type BuildResult =
  | { kind: 'ok'; item: MaterialUploadItem }
  | { kind: 'rejected'; reason: RejectReason; name: string; ext?: string };

const t = (key: string, params?: Record<string, string>): string => {
  const raw = i18nService.t(key);
  if (!params) {
    return raw;
  }
  return Object.entries(params).reduce(
    (acc, [paramKey, value]) => acc.replace(`{${paramKey}}`, value),
    raw,
  );
};

const ACCEPT_ATTRIBUTE = ENTERPRISE_LEAD_MATERIAL_ACCEPT_EXTENSIONS.map(ext => `.${ext}`).join(',');

const DIALOG_FILTERS: DialogFileFilter[] = [
  ...ENTERPRISE_LEAD_MATERIAL_DIALOG_FILTERS.map(filter => ({
    name: filter.name,
    extensions: [...filter.extensions],
  })),
];

const READABLE_EXTENSIONS = new Set<string>(EnterpriseLeadReadableDocumentExtensions);
const IMAGE_EXTENSIONS = new Set<string>(EnterpriseLeadImageAttachmentExtensions);
const ATTACHMENT_ONLY_EXTENSIONS = new Set<string>(EnterpriseLeadAttachmentOnlyDocumentExtensions);

const ALL_SUPPORTED_EXTENSIONS = new Set<string>([
  ...READABLE_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
  ...ATTACHMENT_ONLY_EXTENSIONS,
]);

const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes <= 0) {
    return '';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getExtension = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

const getBaseName = (fileName: string): string => {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(0, dotIndex) : fileName;
};

const buildItemFromPath = async (
  dialogApi: Window['electron']['dialog'],
  filePath: string,
): Promise<BuildResult> => {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  const fileName = segments[segments.length - 1] || filePath;
  const extension = getExtension(fileName);
  const id = `${fileName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let fileSize: number | null = null;
  if (typeof dialogApi.statFile === 'function') {
    const stat = await dialogApi.statFile(filePath).catch(() => null);
    if (stat?.success && typeof stat.size === 'number') {
      fileSize = stat.size;
    }
  }

  if (fileSize !== null && fileSize > MAX_MATERIAL_UPLOAD_BYTES) {
    return { kind: 'rejected', reason: 'oversize', name: filePath };
  }

  if (!ALL_SUPPORTED_EXTENSIONS.has(extension)) {
    return { kind: 'rejected', reason: 'unsupported', name: filePath, ext: extension };
  }

  if (IMAGE_EXTENSIONS.has(extension)) {
    return {
      kind: 'ok',
      item: {
        id,
        filePath,
        fileName,
        fileSize,
        kind: 'image',
      },
    };
  }

  if (READABLE_EXTENSIONS.has(extension) && typeof dialogApi.readTextFile === 'function') {
    const readResult = await dialogApi.readTextFile(filePath);
    if (!readResult.success) {
      return { kind: 'rejected', reason: 'read', name: filePath };
    }
    return {
      kind: 'ok',
      item: {
        id,
        filePath,
        fileName,
        fileSize,
        kind: 'file',
        text: readResult.content ?? '',
        truncated: Boolean(readResult.truncated),
      },
    };
  }

  // ATTACHMENT_ONLY_EXTENSIONS (doc/ppt) or readable extension without readTextFile
  return {
    kind: 'ok',
    item: {
      id,
      filePath,
      fileName,
      fileSize,
      kind: 'file',
    },
  };
};

const getFileIcon = (item: MaterialUploadItem): React.ReactNode => {
  const extension = getExtension(item.fileName);
  if (IMAGE_EXTENSIONS.has(extension)) {
    return <PhotoIcon className="h-4 w-4" />;
  }
  if (READABLE_EXTENSIONS.has(extension) && /\.(xlsx?|csv|tsv)$/.test(extension)) {
    return <TableCellsIcon className="h-4 w-4" />;
  }
  return <DocumentIcon className="h-4 w-4" />;
};

const rejectionToMessage = (rejection: Extract<BuildResult, { kind: 'rejected' }>): string => {
  if (rejection.reason === 'oversize') {
    return t('enterpriseLeadMaterialFileSizeExceeded', { name: rejection.name });
  }
  if (rejection.reason === 'unsupported') {
    return t('enterpriseLeadMaterialUnsupportedType', { ext: rejection.ext ?? '' });
  }
  return t('enterpriseLeadMaterialReadFailed', { name: rejection.name });
};

export const WorkspaceMaterialUpload: React.FC<WorkspaceMaterialUploadProps> = ({
  items,
  onItemsChange,
  onError,
  disabled = false,
}) => {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const requestIdRef = useRef(0);

  const acceptAttr = useMemo(() => ACCEPT_ATTRIBUTE, []);

  const appendItems = useCallback(
    async (paths: string[]) => {
      const dialogApi = window.electron?.dialog;
      if (!dialogApi) {
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const additions: MaterialUploadItem[] = [];
      const rejections: string[] = [];

      for (const filePath of paths) {
        const result = await buildItemFromPath(dialogApi, filePath);
        if (result.kind === 'rejected') {
          rejections.push(rejectionToMessage(result));
          continue;
        }
        additions.push(result.item);
      }

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (additions.length > 0) {
        onItemsChange([...items, ...additions]);
      }
      if (rejections.length > 0) {
        onError(rejections.join('\n'));
      }
    },
    [items, onItemsChange, onError],
  );

  const handleChooseClick = useCallback((): void => {
    const dialogApi = window.electron?.dialog;
    if (dialogApi?.selectFiles) {
      void dialogApi
        .selectFiles({
          title: t('enterpriseLeadCreateMaterialTitle'),
          filters: DIALOG_FILTERS,
        })
        .then(result => {
          if (!result.success || !Array.isArray(result.paths) || result.paths.length === 0) {
            return;
          }
          void appendItems(result.paths);
        });
      return;
    }
    fileInputRef.current?.click();
  }, [appendItems]);

  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const files = event.currentTarget.files;
      event.currentTarget.value = '';
      if (!files || files.length === 0) {
        return;
      }
      const paths: string[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file) continue;
        const maybePath = (file as File & { path?: unknown }).path;
        if (typeof maybePath === 'string' && maybePath.length > 0) {
          paths.push(maybePath);
        }
      }
      if (paths.length > 0) {
        void appendItems(paths);
      }
    },
    [appendItems],
  );

  const handleRemove = useCallback(
    (id: string): void => {
      onItemsChange(items.filter(item => item.id !== id));
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

      <input
        id={inputId}
        ref={fileInputRef}
        type="file"
        accept={acceptAttr}
        multiple
        className="sr-only"
        onChange={handleFileInputChange}
      />

      {items.length > 0 && (
        <ul className="grid gap-1.5 rounded-lg border border-border bg-surface px-3 py-2">
          {items.map(item => (
            <li
              key={item.id}
              className="grid grid-cols-[20px_minmax(0,1fr)_auto_auto] items-center gap-2 text-xs"
            >
              <span className="text-secondary">{getFileIcon(item)}</span>
              <span className="truncate text-foreground" title={item.fileName}>
                {getBaseName(item.fileName)}
                <span className="text-secondary">.{getExtension(item.fileName)}</span>
                {item.truncated && (
                  <span className="ml-2 rounded bg-amber-500/15 px-1 text-amber-700 dark:text-amber-300">
                    truncated
                  </span>
                )}
              </span>
              <span className="text-secondary">{formatBytes(item.fileSize)}</span>
              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                disabled={disabled}
                aria-label={`Remove ${item.fileName}`}
                className="grid h-6 w-6 place-items-center rounded text-secondary hover:bg-surface-raised hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <XMarkIcon className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <button
          type="button"
          onClick={handleChooseClick}
          disabled={disabled}
          className="self-start text-xs font-semibold text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('enterpriseLeadMaterialAddMore')}
        </button>
      )}
    </div>
  );
};

import {
  EnterpriseLeadAttachmentOnlyDocumentExtensions,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadImageAttachmentExtensions,
  EnterpriseLeadReadableDocumentExtensions,
} from '../../../shared/enterpriseLeadWorkspace/constants';

export const EnterpriseLeadKnowledgeDocumentUploadOutcome = {
  Ready: 'ready',
  AttachmentOnly: 'attachment_only',
  ImageNeedsSummary: 'image_needs_summary',
  ReadFailed: 'read_failed',
  Unsupported: 'unsupported',
} as const;

export type EnterpriseLeadKnowledgeDocumentUploadOutcome =
  (typeof EnterpriseLeadKnowledgeDocumentUploadOutcome)[keyof typeof EnterpriseLeadKnowledgeDocumentUploadOutcome];

export interface EnterpriseLeadKnowledgeDocumentUploadDialogApi {
  statFile?: (filePath: string) => Promise<{
    success: boolean;
    size?: number;
  }>;
  readTextFile?: (filePath: string) => Promise<{
    success: boolean;
    content?: string;
    truncated?: boolean;
  }>;
  extractImageText?: (filePath: string) => Promise<{
    success: boolean;
    content?: string;
  }>;
}

export interface EnterpriseLeadKnowledgeUploadedDocument {
  extractImmediately: boolean;
  fileName: string;
  filePath: string;
  fileSize: number | null;
  sourceType: EnterpriseLeadExtractionSourceKind;
  text: string;
  truncated: boolean;
}

export interface EnterpriseLeadKnowledgeDocumentUploadResult {
  outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome;
  document?: EnterpriseLeadKnowledgeUploadedDocument;
}

const readableDocumentExtensions = new Set<string>(EnterpriseLeadReadableDocumentExtensions);
const imageExtensions = new Set<string>(EnterpriseLeadImageAttachmentExtensions);
const attachmentOnlyExtensions = new Set<string>(EnterpriseLeadAttachmentOnlyDocumentExtensions);
const supportedExtensions = new Set<string>([
  ...readableDocumentExtensions,
  ...imageExtensions,
  ...attachmentOnlyExtensions,
]);

const getFileName = (filePath: string): string => {
  const segments = filePath.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
};

const getFileExtension = (filePath: string): string => {
  const fileName = getFileName(filePath);
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : '';
};

const readFileSize = async (
  dialogApi: EnterpriseLeadKnowledgeDocumentUploadDialogApi,
  filePath: string,
): Promise<number | null> => {
  if (!dialogApi.statFile) {
    return null;
  }
  try {
    const result = await dialogApi.statFile(filePath);
    return result.success && typeof result.size === 'number' ? result.size : null;
  } catch {
    return null;
  }
};

const createDocument = (
  filePath: string,
  fileSize: number | null,
  sourceType: EnterpriseLeadExtractionSourceKind,
  text = '',
  truncated = false,
  extractImmediately = false,
): EnterpriseLeadKnowledgeUploadedDocument => ({
  extractImmediately,
  fileName: getFileName(filePath),
  filePath,
  fileSize,
  sourceType,
  text,
  truncated,
});

export const resolveEnterpriseLeadKnowledgeDocumentUpload = async (
  dialogApi: EnterpriseLeadKnowledgeDocumentUploadDialogApi,
  inputPath: string,
): Promise<EnterpriseLeadKnowledgeDocumentUploadResult> => {
  const filePath = inputPath.trim();
  const extension = getFileExtension(filePath);
  if (!supportedExtensions.has(extension)) {
    return { outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.Unsupported };
  }

  const fileSize = await readFileSize(dialogApi, filePath);
  if (imageExtensions.has(extension)) {
    const fallbackDocument = createDocument(
      filePath,
      fileSize,
      EnterpriseLeadExtractionSourceKind.Image,
    );
    if (!dialogApi.extractImageText) {
      return {
        outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ImageNeedsSummary,
        document: fallbackDocument,
      };
    }
    try {
      const result = await dialogApi.extractImageText(filePath);
      const text = result.success ? (result.content?.trim() ?? '') : '';
      if (!text) {
        return {
          outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ImageNeedsSummary,
          document: fallbackDocument,
        };
      }
      return {
        outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.Ready,
        document: createDocument(
          filePath,
          fileSize,
          EnterpriseLeadExtractionSourceKind.Image,
          text,
          false,
          true,
        ),
      };
    } catch {
      return {
        outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ImageNeedsSummary,
        document: fallbackDocument,
      };
    }
  }

  const fallbackDocument = createDocument(
    filePath,
    fileSize,
    EnterpriseLeadExtractionSourceKind.File,
  );
  if (attachmentOnlyExtensions.has(extension)) {
    return {
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.AttachmentOnly,
      document: fallbackDocument,
    };
  }
  if (!dialogApi.readTextFile) {
    return {
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ReadFailed,
      document: fallbackDocument,
    };
  }
  try {
    const result = await dialogApi.readTextFile(filePath);
    if (!result.success) {
      return {
        outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ReadFailed,
        document: fallbackDocument,
      };
    }
    const text = result.content?.trim() ?? '';
    if (!text) {
      return {
        outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.AttachmentOnly,
        document: fallbackDocument,
      };
    }
    return {
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.Ready,
      document: createDocument(
        filePath,
        fileSize,
        EnterpriseLeadExtractionSourceKind.File,
        text,
        Boolean(result.truncated),
        true,
      ),
    };
  } catch {
    return {
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ReadFailed,
      document: fallbackDocument,
    };
  }
};

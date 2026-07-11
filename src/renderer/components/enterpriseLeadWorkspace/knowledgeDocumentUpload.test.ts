import { describe, expect, test, vi } from 'vitest';

import { EnterpriseLeadExtractionSourceKind } from '../../../shared/enterpriseLeadWorkspace/constants';
import {
  EnterpriseLeadKnowledgeDocumentUploadOutcome,
  resolveEnterpriseLeadKnowledgeDocumentUpload,
} from './knowledgeDocumentUpload';

describe('resolveEnterpriseLeadKnowledgeDocumentUpload', () => {
  test.each(['/tmp/company-profile.pdf', '/tmp/product-deck.pptx'])(
    'reads supported document text before queuing %s for knowledge extraction',
    async filePath => {
      const readTextFile = vi.fn().mockResolvedValue({
        success: true,
        content: '可用于知识提取的资料正文',
        size: 4096,
        truncated: false,
      });

      const result = await resolveEnterpriseLeadKnowledgeDocumentUpload({ readTextFile }, filePath);

      expect(readTextFile).toHaveBeenCalledWith(filePath);
      expect(result).toEqual({
        outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.Ready,
        document: expect.objectContaining({
          extractImmediately: true,
          fileName: filePath.split('/').pop(),
          sourceType: EnterpriseLeadExtractionSourceKind.File,
          text: '可用于知识提取的资料正文',
        }),
      });
    },
  );

  test('uses the OCR bridge for image uploads and queues recognized text', async () => {
    const extractImageText = vi.fn().mockResolvedValue({
      success: true,
      content: '工厂设备与产品参数',
    });
    const readTextFile = vi.fn();

    const result = await resolveEnterpriseLeadKnowledgeDocumentUpload(
      { extractImageText, readTextFile },
      '/tmp/factory-photo.png',
    );

    expect(extractImageText).toHaveBeenCalledWith('/tmp/factory-photo.png');
    expect(readTextFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.Ready,
      document: expect.objectContaining({
        extractImmediately: true,
        sourceType: EnterpriseLeadExtractionSourceKind.Image,
        text: '工厂设备与产品参数',
      }),
    });
  });

  test('keeps an image as an attachment when OCR produces no text', async () => {
    const result = await resolveEnterpriseLeadKnowledgeDocumentUpload(
      {
        extractImageText: vi.fn().mockResolvedValue({ success: true, content: '   ' }),
      },
      '/tmp/empty-scan.jpg',
    );

    expect(result).toEqual({
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.ImageNeedsSummary,
      document: expect.objectContaining({
        extractImmediately: false,
        sourceType: EnterpriseLeadExtractionSourceKind.Image,
        text: '',
      }),
    });
  });

  test('keeps legacy office files as attachments without forcing extraction', async () => {
    const result = await resolveEnterpriseLeadKnowledgeDocumentUpload({}, '/tmp/legacy-deck.ppt');

    expect(result).toEqual({
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.AttachmentOnly,
      document: expect.objectContaining({
        extractImmediately: false,
        sourceType: EnterpriseLeadExtractionSourceKind.File,
        text: '',
      }),
    });
  });

  test('rejects file extensions that are not supported by workspace materials', async () => {
    await expect(
      resolveEnterpriseLeadKnowledgeDocumentUpload({}, '/tmp/application.exe'),
    ).resolves.toEqual({
      outcome: EnterpriseLeadKnowledgeDocumentUploadOutcome.Unsupported,
    });
  });
});

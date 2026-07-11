import fs from 'node:fs';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';

import type { KnowledgeFileSelection } from '../../../shared/knowledgeBase/types';
import { i18nService } from '../../services/i18n';
import type { WorkspaceMaterialSelectionItem } from './workspaceCreationKnowledgeImport';

const selection = (): KnowledgeFileSelection => ({
  selectionToken: 'secret-selection-token',
  files: [
    { itemId: 'item-a', displayName: 'a.pdf', fileSize: 100 },
    { itemId: 'item-b', displayName: 'b.png', fileSize: 200 },
  ],
});

describe('WorkspaceMaterialUpload secure selection boundary', () => {
  test('routes workspace creation through normalized imports without renderer OCR', () => {
    const source = fs.readFileSync(new URL('./WorkspaceCreate.tsx', import.meta.url), 'utf8');

    expect(source).toContain('createWorkspaceWithKnowledgeImports');
    expect(source).not.toContain('createWorkspaceFromUploadedMaterials');
    expect(source).not.toContain('processDocumentSource');
    expect(source).not.toContain('ocrService');
    expect(source).not.toContain('extractImageText');
    expect(source).not.toContain('filePath');
  });

  test('opens source documents when creation imports have failures', async () => {
    const module = await import('./EnterpriseLeadWorkspaceView');

    expect(module.getWorkspacePageAfterCreationImport).toEqual(expect.any(Function));
    if (!module.getWorkspacePageAfterCreationImport) {
      return;
    }

    expect(
      module.getWorkspacePageAfterCreationImport({
        importedCount: 1,
        failedCount: 1,
        items: [],
      }),
    ).toBe('knowledge_base');
    expect(module.getWorkspacePageAfterCreationImport(undefined)).toBe('workbench');
  });

  test('threads the initial batch result into the normalized document panel', () => {
    const viewSource = fs.readFileSync(
      new URL('./EnterpriseLeadWorkspaceView.tsx', import.meta.url),
      'utf8',
    );
    const knowledgeSource = fs.readFileSync(
      new URL('./WorkspaceKnowledgeBase.tsx', import.meta.url),
      'utf8',
    );
    const panelSource = fs.readFileSync(
      new URL('./WorkspaceKnowledgeDocumentsPanel.tsx', import.meta.url),
      'utf8',
    );

    expect(viewSource).toContain('initialKnowledgeImportResult');
    expect(viewSource).toContain('handleInitialKnowledgeImportConsumed');
    expect(knowledgeSource).toContain('initialImportResult');
    expect(knowledgeSource).toContain('pendingInitialImportResult');
    expect(knowledgeSource).toContain('onInitialImportResultConsumed');
    expect(panelSource).toContain('initialImportResult');
  });

  test('presents local storage as one source-document view instead of a separate library', () => {
    expect(i18nService.t('enterpriseKnowledgeDocumentsTitle')).toBe('资料文档');
    expect(i18nService.t('enterpriseLeadKnowledgeDocumentLibraryTitle')).toBe('资料文档');
    expect(i18nService.t('enterpriseLeadCreateMaterialFooterHint')).toContain('统一加入');
    expect(i18nService.t('enterpriseLeadCreateMaterialFooterHint')).not.toContain(
      '生成初始业务画像',
    );
  });

  test('does not use renderer path, text-read, or OCR APIs', () => {
    const source = fs.readFileSync(
      new URL('./WorkspaceMaterialUpload.tsx', import.meta.url),
      'utf8',
    );

    expect(source).toContain('knowledgeBaseService');
    expect(source).toContain('.selectFiles()');
    expect(source).not.toContain('dialogApi');
    expect(source).not.toContain('readTextFile');
    expect(source).not.toContain('statFile');
    expect(source).not.toContain('extractImageText');
    expect(source).not.toContain('filePath');
    expect(source).not.toContain('type="file"');
  });

  test('maps picker metadata to display-only creation items', async () => {
    const module = await import('./WorkspaceMaterialUpload');

    expect(module.mergeWorkspaceMaterialSelection).toEqual(expect.any(Function));
    if (!module.mergeWorkspaceMaterialSelection) {
      return;
    }

    expect(module.mergeWorkspaceMaterialSelection([], selection())).toEqual({
      items: [
        {
          itemId: 'item-a',
          displayName: 'a.pdf',
          fileSize: 100,
          selectionToken: 'secret-selection-token',
        },
        {
          itemId: 'item-b',
          displayName: 'b.png',
          fileSize: 200,
          selectionToken: 'secret-selection-token',
        },
      ],
      limitExceeded: false,
    });
  });

  test('keeps existing items when a new picker batch exceeds the total limit', async () => {
    const module = await import('./WorkspaceMaterialUpload');
    const existing: WorkspaceMaterialSelectionItem[] = Array.from({ length: 99 }, (_, index) => ({
      itemId: `existing-${index}`,
      displayName: `existing-${index}.txt`,
      fileSize: 1,
      selectionToken: 'existing-token',
    }));

    expect(module.mergeWorkspaceMaterialSelection).toEqual(expect.any(Function));
    if (!module.mergeWorkspaceMaterialSelection) {
      return;
    }

    const result = module.mergeWorkspaceMaterialSelection(existing, selection());

    expect(result).toEqual({ items: existing, limitExceeded: true });
  });

  test('renders names and sizes without exposing the selection token', async () => {
    const module = await import('./WorkspaceMaterialUpload');
    const items: WorkspaceMaterialSelectionItem[] = [
      {
        itemId: 'item-a',
        displayName: 'safe-name.pdf',
        fileSize: 1_024,
        selectionToken: 'secret-selection-token',
      },
    ];
    let html = '';

    try {
      html = renderToStaticMarkup(
        React.createElement(module.WorkspaceMaterialUpload, {
          items,
          onItemsChange: vi.fn(),
          onError: vi.fn(),
        }),
      );
    } catch {
      html = '';
    }

    expect(html).toContain('safe-name.pdf');
    expect(html).toContain('1.0 KB');
    expect(html).not.toContain('secret-selection-token');
  });
});

import { dialog, ipcMain } from 'electron';

import {
  IndustryExportFormat,
  type IndustryExportFormat as IndustryExportFormatValue,
  IndustryMarketingIpc,
} from '../../shared/industryPack/constants';
import type { IndustryGenerationRequest } from '../../shared/industryPack/types';
import type { ContentGenerationService } from './contentGenerationService';
import {
  renderAssetMarkdown,
  renderCalendarCsvCompatibleRows,
  writeExcelExport,
  writeMarkdownExport,
} from './exportService';
import type { IndustryPackLoader } from './industryPackLoader';
import type { IndustryPackStore } from './industryPackStore';

export interface IndustryPackHandlerDeps {
  loader: Pick<IndustryPackLoader, 'listPacks' | 'getPack'>;
  service: Pick<ContentGenerationService, 'generate'>;
  store: Pick<IndustryPackStore, 'getGeneratedAsset' | 'listGeneratedAssets'>;
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown industry marketing error';

const sanitizeExportFileName = (value: string): string => {
  const sanitized = value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'industry-marketing-content';
};

const isIndustryExportFormat = (value: unknown): value is IndustryExportFormatValue =>
  value === IndustryExportFormat.Markdown || value === IndustryExportFormat.Excel;

export function registerIndustryPackHandlers(deps: IndustryPackHandlerDeps): void {
  ipcMain.handle(IndustryMarketingIpc.ListPacks, async () => {
    try {
      return {
        success: true,
        packs: deps.loader.listPacks(),
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(IndustryMarketingIpc.GetPack, async (_event, packId: string) => {
    try {
      return {
        success: true,
        pack: deps.loader.getPack(packId),
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(IndustryMarketingIpc.Generate, async (
    _event,
    request: IndustryGenerationRequest,
  ) => {
    try {
      const result = await deps.service.generate(request);
      return {
        success: true,
        ...result,
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(IndustryMarketingIpc.ListAssets, async (_event, workspaceId: string) => {
    try {
      return {
        success: true,
        assets: deps.store.listGeneratedAssets(workspaceId),
      };
    } catch (error) {
      return { success: false, error: toErrorMessage(error) };
    }
  });

  ipcMain.handle(
    IndustryMarketingIpc.ExportAsset,
    async (_event, input: { assetId?: unknown; format?: unknown }) => {
      try {
        if (typeof input?.assetId !== 'string' || input.assetId.trim().length === 0) {
          throw new Error('Export asset id is required');
        }
        if (!isIndustryExportFormat(input.format)) {
          throw new Error('Unsupported industry export format');
        }

        const asset = deps.store.getGeneratedAsset(input.assetId);
        if (!asset) {
          throw new Error('Generated asset not found');
        }

        const isMarkdown = input.format === IndustryExportFormat.Markdown;
        const result = await dialog.showSaveDialog({
          defaultPath: `${sanitizeExportFileName(asset.title)}.${isMarkdown ? 'md' : 'xlsx'}`,
          filters: isMarkdown
            ? [{ name: 'Markdown', extensions: ['md'] }]
            : [{ name: 'Excel', extensions: ['xlsx'] }],
        });

        if (result.canceled || !result.filePath) {
          return { success: false, canceled: true };
        }

        if (isMarkdown) {
          writeMarkdownExport(result.filePath, renderAssetMarkdown(asset));
        } else {
          writeExcelExport(result.filePath, renderCalendarCsvCompatibleRows([{
            day: 1,
            channel: asset.channel,
            theme: asset.theme,
            title: asset.title,
            body: asset.body,
            cta: asset.cta,
          }]));
        }

        return {
          success: true,
          filePath: result.filePath,
        };
      } catch (error) {
        return { success: false, error: toErrorMessage(error) };
      }
    },
  );
}

import { ipcMain } from 'electron';

import {
  type ContentQualityRegressionApplyPromptPatchRequest,
  type ContentQualityRegressionApplyPromptPatchResponse,
  ContentQualityRegressionIpc,
  type ContentQualityRegressionRunReportRequest,
  type ContentQualityRegressionRunReportResponse,
} from '../../../shared/contentQualityRegression/constants';
import type { ApplyContentQualityPromptPatchToAgentResult } from '../../libs/contentQualityPromptPatchApply';
import type { ContentQualityModelClient } from '../../libs/contentQualityRegressionLiveRunner';
import {
  type ContentQualityRegressionReportJobOptions,
  type ContentQualityRegressionReportJobResult,
  runContentQualityRegressionReportJob,
} from '../../libs/contentQualityRegressionReportJob';
import {
  CONTENT_QUALITY_REGRESSION_CASES,
  type ContentQualityRegressionCase,
} from '../../libs/contentQualityRegressionSuite';

export interface ContentQualityRegressionHandlerDeps {
  getReportDir: () => string;
  generator: ContentQualityModelClient;
  evaluator: ContentQualityModelClient;
  runReportJob?: (
    options: ContentQualityRegressionReportJobOptions,
  ) => Promise<ContentQualityRegressionReportJobResult>;
  applyPromptPatchToAgent?: (
    request: ContentQualityRegressionApplyPromptPatchRequest,
  ) => Promise<ApplyContentQualityPromptPatchToAgentResult>;
  syncOpenClawConfig?: (reason: string) => Promise<void> | void;
}

const MAX_CASE_LIMIT = CONTENT_QUALITY_REGRESSION_CASES.length;

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown content quality regression error';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readRunReportRequest = (value: unknown): ContentQualityRegressionRunReportRequest => {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isPlainObject(value)) {
    throw new Error('Content quality regression request must be an object');
  }

  const request: ContentQualityRegressionRunReportRequest = {};

  if (value.caseIds !== undefined) {
    if (!Array.isArray(value.caseIds) || !value.caseIds.every(item => typeof item === 'string')) {
      throw new Error('Content quality regression caseIds must be a string array');
    }
    request.caseIds = value.caseIds;
  }

  if (value.caseLimit !== undefined) {
    if (
      typeof value.caseLimit !== 'number' ||
      !Number.isInteger(value.caseLimit) ||
      value.caseLimit < 1 ||
      value.caseLimit > MAX_CASE_LIMIT
    ) {
      throw new Error(
        `Content quality regression caseLimit must be between 1 and ${MAX_CASE_LIMIT}`,
      );
    }
    request.caseLimit = value.caseLimit;
  }

  return request;
};

const selectCases = (
  request: ContentQualityRegressionRunReportRequest,
): ContentQualityRegressionCase[] => {
  let cases = CONTENT_QUALITY_REGRESSION_CASES;

  if (request.caseIds?.length) {
    const casesById = new Map(cases.map(testCase => [testCase.id, testCase]));
    cases = request.caseIds.map(caseId => {
      const testCase = casesById.get(caseId);
      if (!testCase) {
        throw new Error(`Unknown content quality regression case id: ${caseId}`);
      }
      return testCase;
    });
  }

  if (request.caseLimit !== undefined) {
    cases = cases.slice(0, request.caseLimit);
  }

  return cases;
};

const readApplyPromptPatchRequest = (
  value: unknown,
): ContentQualityRegressionApplyPromptPatchRequest => {
  if (!isPlainObject(value)) {
    throw new Error('Content quality prompt patch request must be an object');
  }

  if (typeof value.agentId !== 'string' || !value.agentId.trim()) {
    throw new Error('Content quality prompt patch request requires agentId');
  }

  const request: ContentQualityRegressionApplyPromptPatchRequest = {
    agentId: value.agentId.trim(),
  };

  if (value.promptPatch !== undefined) {
    if (typeof value.promptPatch !== 'string') {
      throw new Error('Content quality prompt patch must be a string');
    }
    if (value.promptPatch.trim()) {
      request.promptPatch = value.promptPatch.trim();
    }
  }

  if (value.promptPatchPath !== undefined) {
    if (typeof value.promptPatchPath !== 'string') {
      throw new Error('Content quality prompt patch path must be a string');
    }
    if (value.promptPatchPath.trim()) {
      request.promptPatchPath = value.promptPatchPath.trim();
    }
  }

  if (!request.promptPatch && !request.promptPatchPath) {
    throw new Error('Content quality prompt patch request requires promptPatch or promptPatchPath');
  }

  return request;
};

export function registerContentQualityRegressionHandlers(
  deps: ContentQualityRegressionHandlerDeps,
): void {
  ipcMain.handle(
    ContentQualityRegressionIpc.RunReport,
    async (_event, rawRequest?: unknown): Promise<ContentQualityRegressionRunReportResponse> => {
      try {
        const request = readRunReportRequest(rawRequest);
        const result = await (deps.runReportJob ?? runContentQualityRegressionReportJob)({
          cases: selectCases(request),
          reportDir: deps.getReportDir(),
          generator: deps.generator,
          evaluator: deps.evaluator,
        });

        return {
          success: true,
          reportPath: result.reportPath,
          promptPatchPath: result.promptPatchPath,
          total: result.report.total,
          passed: result.report.passed,
          failed: result.report.failed,
          passRate: result.report.passRate,
          averageScore: result.report.averageScore,
        };
      } catch (error) {
        return {
          success: false,
          error: toErrorMessage(error),
        };
      }
    },
  );

  ipcMain.handle(
    ContentQualityRegressionIpc.ApplyPromptPatchToAgent,
    async (
      _event,
      rawRequest?: unknown,
    ): Promise<ContentQualityRegressionApplyPromptPatchResponse> => {
      try {
        if (!deps.applyPromptPatchToAgent) {
          throw new Error('Content quality prompt patch application is not configured');
        }
        const request = readApplyPromptPatchRequest(rawRequest);
        const result = await deps.applyPromptPatchToAgent(request);
        await deps.syncOpenClawConfig?.('content-quality-prompt-patch-applied');

        return {
          success: true,
          agentId: result.agentId,
          appliedAt: result.appliedAt,
          backupPath: result.backupPath,
          ...(result.promptPatchPath ? { promptPatchPath: result.promptPatchPath } : {}),
        };
      } catch (error) {
        return {
          success: false,
          error: toErrorMessage(error),
        };
      }
    },
  );
}

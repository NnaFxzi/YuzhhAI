import fs from 'fs';
import path from 'path';

import {
  type ContentQualityLiveRunnerOptions,
  type ContentQualityModelClient,
  formatContentQualityPromptPatch,
  formatContentQualityRegressionReport,
  runContentQualityRegressionWithModel,
} from './contentQualityRegressionLiveRunner';
import type { ContentQualityRegressionReport } from './contentQualityRegressionRunner';
import {
  CONTENT_QUALITY_REGRESSION_CASES,
  type ContentQualityRegressionCase,
} from './contentQualityRegressionSuite';

export interface ContentQualityRegressionReportJobOptions {
  cases?: ContentQualityRegressionCase[];
  reportDir: string;
  generator: ContentQualityModelClient;
  evaluator: ContentQualityModelClient;
  now?: Date;
  filePrefix?: string;
}

export interface ContentQualityRegressionReportJobResult {
  report: ContentQualityRegressionReport;
  markdown: string;
  promptPatch: string;
  reportPath: string;
  promptPatchPath: string;
}

const buildReportBaseFileName = (date: Date, filePrefix: string): string => {
  const timestamp = date
    .toISOString()
    .replace(/\.\d{3}Z$/, '')
    .replace(/[:T]/g, '-');
  return `${filePrefix}-${timestamp}`;
};

const buildReportFileName = (date: Date, filePrefix: string): string =>
  `${buildReportBaseFileName(date, filePrefix)}.md`;

const buildPromptPatchFileName = (date: Date, filePrefix: string): string =>
  `${buildReportBaseFileName(date, filePrefix)}.prompt-patch.txt`;

export const runContentQualityRegressionReportJob = async ({
  cases = CONTENT_QUALITY_REGRESSION_CASES,
  reportDir,
  generator,
  evaluator,
  now = new Date(),
  filePrefix = 'content-quality-regression',
}: ContentQualityRegressionReportJobOptions): Promise<ContentQualityRegressionReportJobResult> => {
  const runnerOptions: ContentQualityLiveRunnerOptions = {
    cases,
    generator,
    evaluator,
  };
  const report = await runContentQualityRegressionWithModel(runnerOptions);
  const markdown = formatContentQualityRegressionReport(report);
  const promptPatch = formatContentQualityPromptPatch(report);

  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, buildReportFileName(now, filePrefix));
  const promptPatchPath = path.join(reportDir, buildPromptPatchFileName(now, filePrefix));
  fs.writeFileSync(reportPath, markdown, 'utf8');
  fs.writeFileSync(promptPatchPath, promptPatch, 'utf8');

  return {
    report,
    markdown,
    promptPatch,
    reportPath,
    promptPatchPath,
  };
};

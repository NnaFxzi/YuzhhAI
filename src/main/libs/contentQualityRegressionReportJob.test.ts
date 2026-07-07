import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';

import { runContentQualityRegressionReportJob } from './contentQualityRegressionReportJob';
import { CONTENT_QUALITY_REGRESSION_CASES } from './contentQualityRegressionSuite';

describe('contentQualityRegressionReportJob', () => {
  test('runs the quality regression suite and writes a markdown report file', async () => {
    const reportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lobsterai-content-quality-report-'));
    const cases = CONTENT_QUALITY_REGRESSION_CASES.slice(0, 2);

    try {
      const result = await runContentQualityRegressionReportJob({
        cases,
        reportDir,
        now: new Date('2026-07-07T08:30:00.000Z'),
        generator: {
          complete: async ({ testCase }) =>
            testCase.id === 'moments-single-heavy-packaging'
              ? '我们做重型纸箱、蜂窝箱、纸护角和纸托盘，可根据产品尺寸评估替代木箱方案。'
              : '肯定最低价，当天交货，所有设备都能用。',
        },
        evaluator: {
          complete: async ({ prompt }) =>
            prompt.includes('当天交货')
              ? JSON.stringify({
                  scores: {
                    channel_fit: 6,
                    factory_profile_reuse: 5,
                    human_voice: 5,
                    conversion_action: 3,
                    factual_boundaries: 2,
                    specificity: 4,
                  },
                  shouldRewrite: true,
                  reasons: ['硬承诺过多'],
                  rewriteFocus: ['删除最低价和当天交货'],
                })
              : JSON.stringify({
                  scores: {
                    channel_fit: 9,
                    factory_profile_reuse: 9,
                    human_voice: 8,
                    conversion_action: 8,
                    factual_boundaries: 9,
                    specificity: 8,
                  },
                  shouldRewrite: false,
                  reasons: [],
                  rewriteFocus: [],
                }),
        },
      });

      expect(result.reportPath).toBe(
        path.join(reportDir, 'content-quality-regression-2026-07-07-08-30-00.md'),
      );
      expect(result.promptPatchPath).toBe(
        path.join(reportDir, 'content-quality-regression-2026-07-07-08-30-00.prompt-patch.txt'),
      );
      expect(result.report.total).toBe(2);
      expect(result.report.passed).toBe(1);
      expect(result.report.failed).toBe(1);
      expect(result.markdown).toContain('# 内容质量回归报告');
      expect(result.markdown).toContain('通过率：50%');
      expect(result.markdown).toContain('硬承诺过多');
      expect(fs.readFileSync(result.reportPath, 'utf8')).toBe(result.markdown);
      expect(fs.readFileSync(result.promptPatchPath, 'utf8')).toContain('[内容质量修复补丁]');
      expect(fs.readFileSync(result.promptPatchPath, 'utf8')).toContain(
        '禁止编造载重、交期、认证、价格、产能、服务区域、客户案例和确定性成本降幅',
      );
    } finally {
      fs.rmSync(reportDir, { recursive: true, force: true });
    }
  });
});

export const ContentQualityRegressionIpc = {
  RunReport: 'contentQualityRegression:report:run',
  ApplyPromptPatchToAgent: 'contentQualityRegression:promptPatch:applyToAgent',
} as const;
export type ContentQualityRegressionIpc =
  (typeof ContentQualityRegressionIpc)[keyof typeof ContentQualityRegressionIpc];

export interface ContentQualityRegressionRunReportRequest {
  caseIds?: string[];
  caseLimit?: number;
}

export type ContentQualityRegressionRunReportResponse =
  | {
      success: true;
      reportPath: string;
      promptPatchPath: string;
      total: number;
      passed: number;
      failed: number;
      passRate: number;
      averageScore: number;
    }
  | {
      success: false;
      error: string;
    };

export interface ContentQualityRegressionApplyPromptPatchRequest {
  agentId: string;
  promptPatch?: string;
  promptPatchPath?: string;
}

export type ContentQualityRegressionApplyPromptPatchResponse =
  | {
      success: true;
      agentId: string;
      appliedAt: string;
      backupPath: string;
      promptPatchPath?: string;
    }
  | {
      success: false;
      error: string;
    };

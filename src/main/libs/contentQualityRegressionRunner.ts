import {
  buildContentQualityEvaluationPrompt,
  CONTENT_QUALITY_REGRESSION_CASES,
  CONTENT_QUALITY_SCORE_DIMENSIONS,
  type ContentQualityRegressionCase,
  type ContentQualityScoreDimensionId,
} from './contentQualityRegressionSuite';

export type ContentQualityScores = Record<ContentQualityScoreDimensionId, number>;

export interface ContentQualityEvaluation {
  scores: ContentQualityScores;
  shouldRewrite: boolean;
  failedDimensions: ContentQualityScoreDimensionId[];
  reasons: string[];
  rewriteFocus: string[];
  averageScore: number;
}

export interface ContentQualityRegressionCaseResult {
  testCase: ContentQualityRegressionCase;
  modelOutput: string;
  evaluationPrompt: string;
  evaluation: ContentQualityEvaluation;
  passed: boolean;
  failedDimensions: ContentQualityScoreDimensionId[];
}

export interface ContentQualityRegressionReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  averageScore: number;
  results: ContentQualityRegressionCaseResult[];
  rewriteCases: ContentQualityRegressionCaseResult[];
}

export interface ContentQualityRegressionRunnerOptions {
  cases?: ContentQualityRegressionCase[];
  generateOutput: (testCase: ContentQualityRegressionCase) => Promise<string> | string;
  evaluateOutput: (input: {
    testCase: ContentQualityRegressionCase;
    modelOutput: string;
    evaluationPrompt: string;
  }) =>
    | Promise<string | Partial<ContentQualityEvaluation>>
    | string
    | Partial<ContentQualityEvaluation>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeScore = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(10, Math.max(0, value));
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
};

const extractJsonObjectText = (value: string): string => {
  const withoutFence = value.replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');

  if (start < 0 || end < start) {
    throw new Error('Content quality evaluation did not contain a JSON object.');
  }

  return withoutFence.slice(start, end + 1);
};

const parseEvaluationInput = (
  input: string | Partial<ContentQualityEvaluation>,
): Record<string, unknown> => {
  if (typeof input === 'string') {
    const parsed = JSON.parse(extractJsonObjectText(input)) as unknown;
    if (!isRecord(parsed)) {
      throw new Error('Content quality evaluation JSON must be an object.');
    }
    return parsed;
  }

  return input as Record<string, unknown>;
};

export const parseContentQualityEvaluation = (
  input: string | Partial<ContentQualityEvaluation>,
): ContentQualityEvaluation => {
  const parsed = parseEvaluationInput(input);
  const rawScores = isRecord(parsed.scores) ? parsed.scores : {};

  const scores = CONTENT_QUALITY_SCORE_DIMENSIONS.reduce((acc, dimension) => {
    acc[dimension.id] = normalizeScore(rawScores[dimension.id]);
    return acc;
  }, {} as ContentQualityScores);

  const failedDimensions = CONTENT_QUALITY_SCORE_DIMENSIONS.filter(
    dimension => scores[dimension.id] < dimension.passScore,
  ).map(dimension => dimension.id);
  const averageScore =
    CONTENT_QUALITY_SCORE_DIMENSIONS.reduce((sum, dimension) => sum + scores[dimension.id], 0) /
    CONTENT_QUALITY_SCORE_DIMENSIONS.length;

  return {
    scores,
    failedDimensions,
    averageScore,
    shouldRewrite: parsed.shouldRewrite === true || failedDimensions.length > 0,
    reasons: normalizeStringArray(parsed.reasons),
    rewriteFocus: normalizeStringArray(parsed.rewriteFocus),
  };
};

export const runContentQualityRegressionSuite = async ({
  cases = CONTENT_QUALITY_REGRESSION_CASES,
  generateOutput,
  evaluateOutput,
}: ContentQualityRegressionRunnerOptions): Promise<ContentQualityRegressionReport> => {
  const results: ContentQualityRegressionCaseResult[] = [];

  for (const testCase of cases) {
    const modelOutput = await generateOutput(testCase);
    const evaluationPrompt = buildContentQualityEvaluationPrompt({
      testCase,
      modelOutput,
    });
    const rawEvaluation = await evaluateOutput({
      testCase,
      modelOutput,
      evaluationPrompt,
    });
    const evaluation = parseContentQualityEvaluation(rawEvaluation);

    results.push({
      testCase,
      modelOutput,
      evaluationPrompt,
      evaluation,
      passed: !evaluation.shouldRewrite,
      failedDimensions: evaluation.failedDimensions,
    });
  }

  const passed = results.filter(result => result.passed).length;
  const total = results.length;
  const failed = total - passed;
  const averageScore =
    total === 0
      ? 0
      : results.reduce((sum, result) => sum + result.evaluation.averageScore, 0) / total;

  return {
    total,
    passed,
    failed,
    passRate: total === 0 ? 0 : passed / total,
    averageScore,
    results,
    rewriteCases: results.filter(result => !result.passed),
  };
};

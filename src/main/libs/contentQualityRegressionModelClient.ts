import type { ModelClientAdapter } from '../industryPack/modelClientAdapter';
import type { ContentQualityModelClient } from './contentQualityRegressionLiveRunner';

export const createContentQualityRegressionModelClient = (
  modelClient: ModelClientAdapter,
): ContentQualityModelClient => ({
  async complete(input) {
    const isEvaluation = input.purpose === 'evaluation';
    const result = await modelClient.generate({
      prompt: input.prompt,
      temperature: isEvaluation ? 0 : 0.35,
      maxTokens: isEvaluation ? 1800 : 2600,
    });
    return result.text;
  },
});

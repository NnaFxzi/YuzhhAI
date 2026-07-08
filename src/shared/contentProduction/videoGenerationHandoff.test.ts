import { describe, expect, test } from 'vitest';

import { VIDEO_GENERATION_HANDOFF_PROMPT } from './videoGenerationHandoff';

describe('VIDEO_GENERATION_HANDOFF_PROMPT', () => {
  test('routes affirmative follow-up into video production with local Remotion fallback', () => {
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('用户随后回复“是的');
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('默认直接进入视频制作');
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('不要只输出提示词或再次追问');
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('云视频工具未启用');
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('Remotion 本地方案');
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain(
      '[视频文件](file:///absolute/path/to/video.mp4)',
    );
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('没有真实视频文件链接的“视频已生成”回复无效');
    expect(VIDEO_GENERATION_HANDOFF_PROMPT).toContain('如果不知道最终 mp4 路径');
  });
});

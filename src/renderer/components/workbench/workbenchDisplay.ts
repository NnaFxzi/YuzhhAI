import { type Artifact, type ArtifactType,ArtifactTypeValue } from '../../types/artifact';
import type { LocalizedPrompt, LocalizedQuickAction, WorkflowOutputType } from '../../types/quickAction';

const ArtifactTypeLabel: Record<ArtifactType, string> = {
  [ArtifactTypeValue.Html]: '网页',
  [ArtifactTypeValue.Svg]: 'SVG',
  [ArtifactTypeValue.Image]: '图片',
  [ArtifactTypeValue.Video]: '视频',
  [ArtifactTypeValue.Mermaid]: '图表',
  [ArtifactTypeValue.Code]: '代码',
  [ArtifactTypeValue.Markdown]: 'Markdown',
  [ArtifactTypeValue.Text]: '文本',
  [ArtifactTypeValue.Document]: '文档',
  [ArtifactTypeValue.LocalService]: '本地服务',
};

const WorkflowOutputLabel: Record<WorkflowOutputType, string> = {
  text: '文本',
  markdown: 'Markdown',
  document: '文档',
  spreadsheet: '表格',
  presentation: 'PPT',
  webpage: '网页',
  image: '图片',
  video: '视频',
};

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || filePath;
}

export function getArtifactDisplayMeta(artifact: Artifact): {
  title: string;
  typeLabel: string;
  pathLabel: string | null;
} {
  return {
    title: artifact.title || artifact.fileName || artifact.type,
    typeLabel: ArtifactTypeLabel[artifact.type],
    pathLabel: artifact.filePath || artifact.url || null,
  };
}

export function getDraftMaterialName(filePath: string): string {
  return basename(filePath);
}

export function getWorkflowOutputLabel(outputType: WorkflowOutputType): string {
  return WorkflowOutputLabel[outputType];
}

export interface FeaturedWorkflowPrompt {
  actionId: string;
  actionLabel: string;
  actionIcon: string;
  prompt: LocalizedPrompt;
}

export function getFeaturedWorkflowPrompts(
  actions: LocalizedQuickAction[],
  maxCount = 4,
): FeaturedWorkflowPrompt[] {
  return actions.flatMap((action) => (
    action.prompts.map((prompt) => ({
      actionId: action.id,
      actionLabel: action.label,
      actionIcon: action.icon,
      prompt,
    }))
  )).slice(0, maxCount);
}

export interface WorkbenchBadgeCounts {
  materialCount: number;
  artifactCount: number;
  taskCount: number;
}

export function getWorkbenchBadgeCount(counts: WorkbenchBadgeCounts): number {
  return counts.materialCount + counts.artifactCount + counts.taskCount;
}

import type {
  GeneratedAssetStatus,
  IndustryPackChannel,
  IndustryPackId,
  IndustryPackTask,
} from './constants';

export interface IndustryPackManifest {
  id: IndustryPackId | string;
  name: string;
  version: string;
  category: string;
  description: string;
  locale: string;
  entryTasks: string[];
  supportedChannels: string[];
  supportedThemes: string[];
  supportedTones: string[];
  defaultOutputSchemas: string[];
}

export interface IndustryPackFieldOption {
  value: string;
  label: string;
}

export interface IndustryPackField {
  id: string;
  label: string;
  kind: 'text' | 'textarea' | 'select' | 'multiselect' | 'number';
  required?: boolean;
  helpText?: string;
  options?: IndustryPackFieldOption[];
}

export interface IndustryPackFieldGroup {
  id: string;
  title: string;
  fields: IndustryPackField[];
}

export interface GenerationPeriod {
  kind: 'today' | 'preset' | 'custom';
  days: number;
}

export interface IndustryGenerationRequest {
  packId: IndustryPackId | string;
  taskId: IndustryPackTask | string;
  period: GenerationPeriod;
  channels: Array<IndustryPackChannel | string>;
  themes: string[];
  tone: string;
  profile: Record<string, unknown>;
  productProfileId?: string;
  caseProfileId?: string;
  supplementalText?: string;
}

export interface GeneratedAsset {
  id: string;
  workspaceId: string;
  taskId: string;
  packId: string;
  channel: string;
  theme: string;
  tone: string;
  title: string;
  body: string;
  keywords: string[];
  cta: string;
  status: GeneratedAssetStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

import type { LocalizedText } from './skill';

export interface KitSkillRef {
  id: string;
  name: string;
}

export interface MarketplaceKit {
  id: string;
  name: string;
  description: string | LocalizedText;
  icon?: string;
  author?: string;
  version?: string;
  tryAsking?: string[];
  skills?: KitSkillRef[];
  mcpServers?: string[];
  downloadCount?: string;
}

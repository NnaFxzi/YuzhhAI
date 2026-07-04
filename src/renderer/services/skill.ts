import { LocalizedText, LocalSkillInfo, MarketplaceSkill, MarketTag, Skill } from '../types/skill';
import { i18nService } from './i18n';
import { LogReporterAction, reportYdAnalyzer } from './logReporter';

export function resolveLocalizedText(text: string | LocalizedText): string {
  if (!text) return '';
  if (typeof text === 'string') return text;
  const lang = i18nService.getLanguage();
  return text[lang] || text.en || '';
}

const CHINESE_SKILL_DESCRIPTION_FALLBACKS: Record<string, string> = {
  'article-writer': '根据主题、素材和目标读者生成结构清晰的文章草稿，适合公众号、博客和内容运营。',
  'content-planner': '规划选题、内容节奏和发布思路，帮助把零散想法整理成可执行的内容计划。',
  'daily-trending': '追踪近期热点和内容趋势，为选题、营销和传播策略提供参考。',
  'docx': '创建、编辑和检查 Word 文档，适合报告、合同、方案和正式文稿。',
  'frontend-design': '设计并优化高质量前端界面，关注布局、视觉风格、交互细节和可用性。',
  'stock-analyzer': '综合行情、财务、技术指标和成长性信息，生成股票分析报告。',
  'stock-announcements': '查找并整理上市公司公告，辅助跟踪财报、分红、融资和重大事项。',
  'stock-explorer': '探索股票、行业和市场线索，帮助发现可进一步分析的标的。',
  'web-search': '联网搜索和读取网页内容，用于获取最新资料、核对事实和补充背景信息。',
  'xlsx': '创建、编辑和分析 Excel 表格，支持数据整理、公式、图表和汇总。',
};

type ResolveSkillDescriptionOptions = {
  fallback: string;
  language: string;
  skillId: string;
  skillName: string;
};

export function resolveSkillDescriptionForDisplay({
  fallback,
  language,
  skillId,
  skillName,
}: ResolveSkillDescriptionOptions): string {
  if (language !== 'zh') {
    return fallback;
  }

  const normalizedId = skillId.trim().toLowerCase();
  const normalizedName = skillName.trim().toLowerCase();
  return CHINESE_SKILL_DESCRIPTION_FALLBACKS[normalizedId]
    ?? CHINESE_SKILL_DESCRIPTION_FALLBACKS[normalizedName]
    ?? fallback;
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(s => parseInt(s, 10) || 0);
  const pb = b.split('.').map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function getSkillAnalyticsSource(skill: Skill): string {
  if (skill.isBuiltIn) return 'built_in';
  if (skill.isOfficial) return 'official';
  return 'custom';
}

type EmailConnectivityCheck = {
  code: 'imap_connection' | 'smtp_connection';
  level: 'pass' | 'fail';
  message: string;
  durationMs: number;
};

type EmailConnectivityTestResult = {
  testedAt: number;
  verdict: 'pass' | 'fail';
  checks: EmailConnectivityCheck[];
};

class SkillService {
  private skills: Skill[] = [];
  private initialized = false;
  private localSkillDescriptions: Map<string, string | LocalizedText> = new Map();
  private marketplaceSkillDescriptions: Map<string, string | LocalizedText> = new Map();
  private installedKitSkillDescriptions: Map<string, string | LocalizedText> = new Map();
  private marketplaceCache: { skills: MarketplaceSkill[]; tags: MarketTag[] } | null = null;
  private marketplaceFetchPromise: Promise<{ skills: MarketplaceSkill[]; tags: MarketTag[] }> | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.loadSkills();
    this.initialized = true;
  }

  async loadSkills(): Promise<Skill[]> {
    try {
      const result = await window.electron.skills.list();
      if (result.success && result.skills) {
        this.skills = result.skills;
      } else {
        this.skills = [];
      }
      await this.loadInstalledKitSkillDescriptions();
      return this.skills;
    } catch (error) {
      console.error('Failed to load skills:', error);
      this.skills = [];
      return this.skills;
    }
  }

  async setSkillEnabled(id: string, enabled: boolean): Promise<Skill[]> {
    try {
      const previousSkill = this.skills.find(skill => skill.id === id);
      const result = await window.electron.skills.setEnabled({ id, enabled });
      if (result.success && result.skills) {
        this.skills = result.skills;
        const updatedSkill = this.skills.find(skill => skill.id === id) ?? previousSkill;
        if (enabled && previousSkill?.enabled !== true && updatedSkill) {
          void reportYdAnalyzer({
            action: LogReporterAction.SkillEnabled,
            skillId: updatedSkill.id,
            skillName: updatedSkill.name,
            skillSource: getSkillAnalyticsSource(updatedSkill),
            isBuiltIn: updatedSkill.isBuiltIn,
            isOfficial: updatedSkill.isOfficial,
            version: updatedSkill.version,
          });
        }
        return this.skills;
      }
      throw new Error(result.error || 'Failed to update skill');
    } catch (error) {
      console.error('Failed to update skill:', error);
      throw error;
    }
  }

  async deleteSkill(id: string): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.delete(id);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete skill';
      console.error('Failed to delete skill:', error);
      return { success: false, error: message };
    }
  }

  async downloadSkill(source: string): Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }> {
    try {
      const result = await window.electron.skills.download(source);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to download skill';
      console.error('Failed to download skill:', error);
      return { success: false, error: message };
    }
  }

  async confirmInstall(
    pendingId: string,
    action: string
  ): Promise<{ success: boolean; skills?: Skill[]; error?: string }> {
    try {
      const result = await window.electron.skills.confirmInstall(pendingId, action);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to confirm install';
      console.error('Failed to confirm install:', error);
      return { success: false, error: message };
    }
  }

  async upgradeSkill(skillId: string, downloadUrl: string): Promise<{
    success: boolean;
    skills?: Skill[];
    error?: string;
    auditReport?: any;
    pendingInstallId?: string;
  }> {
    try {
      const result = await window.electron.skills.upgrade(skillId, downloadUrl);
      if (result.success && result.skills) {
        this.skills = result.skills;
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to upgrade skill';
      console.error('Failed to upgrade skill:', error);
      return { success: false, error: message };
    }
  }

  async getSkillsRoot(): Promise<string | null> {
    try {
      const result = await window.electron.skills.getRoot();
      if (result.success && result.path) {
        return result.path;
      }
      return null;
    } catch (error) {
      console.error('Failed to get skills root:', error);
      return null;
    }
  }

  onSkillsChanged(callback: () => void): () => void {
    return window.electron.skills.onChanged(callback);
  }

  getSkills(): Skill[] {
    return this.skills;
  }

  getEnabledSkills(): Skill[] {
    return this.skills.filter(s => s.enabled);
  }

  getSkillById(id: string): Skill | undefined {
    return this.skills.find(s => s.id === id);
  }

  async getSkillConfig(skillId: string): Promise<Record<string, string>> {
    try {
      const result = await window.electron.skills.getConfig(skillId);
      if (result.success && result.config) {
        return result.config;
      }
      return {};
    } catch (error) {
      console.error('Failed to get skill config:', error);
      return {};
    }
  }

  async setSkillConfig(skillId: string, config: Record<string, string>): Promise<boolean> {
    try {
      const result = await window.electron.skills.setConfig(skillId, config);
      return result.success;
    } catch (error) {
      console.error('Failed to set skill config:', error);
      return false;
    }
  }

  async testEmailConnectivity(
    skillId: string,
    config: Record<string, string>
  ): Promise<EmailConnectivityTestResult | null> {
    try {
      const result = await window.electron.skills.testEmailConnectivity(skillId, config);
      if (result.success && result.result) {
        return result.result;
      }
      return null;
    } catch (error) {
      console.error('Failed to test email connectivity:', error);
      return null;
    }
  }

  async getAutoRoutingPrompt(): Promise<string | null> {
    try {
      const result = await window.electron.skills.autoRoutingPrompt();
      return result.success ? (result.prompt || null) : null;
    } catch (error) {
      console.error('Failed to get auto-routing prompt:', error);
      return null;
    }
  }
  hasLocalizedSkillDescriptions(): boolean {
    return this.localSkillDescriptions.size > 0
      || this.marketplaceSkillDescriptions.size > 0
      || this.installedKitSkillDescriptions.size > 0;
  }

  async fetchMarketplaceSkills(): Promise<{ skills: MarketplaceSkill[]; tags: MarketTag[] }> {
    if (this.marketplaceCache) {
      return this.marketplaceCache;
    }
    if (this.marketplaceFetchPromise) {
      return this.marketplaceFetchPromise;
    }

    this.marketplaceFetchPromise = this.loadMarketplaceSkills();
    const result = await this.marketplaceFetchPromise;
    this.marketplaceFetchPromise = null;
    return result;
  }

  private async loadMarketplaceSkills(): Promise<{ skills: MarketplaceSkill[]; tags: MarketTag[] }> {
    try {
      const result = await window.electron.skills.fetchMarketplace();
      if (!result.success || !result.data) {
        throw new Error(result.error || 'Failed to fetch');
      }
      const json = JSON.parse(result.data);
      const value = json?.data?.value;
      // Store local skill descriptions for i18n lookup
      const localSkills: LocalSkillInfo[] = Array.isArray(value?.localSkill) ? value.localSkill : [];
      this.localSkillDescriptions.clear();
      for (const ls of localSkills) {
        this.localSkillDescriptions.set(ls.name, ls.description);
        this.localSkillDescriptions.set(ls.id, ls.description);
      }
      const skills: MarketplaceSkill[] = Array.isArray(value?.marketplace) ? value.marketplace : [];
      const tags: MarketTag[] = Array.isArray(value?.marketTags) ? value.marketTags : [];
      // Also store marketplace skill descriptions for i18n lookup (keyed by id)
      this.marketplaceSkillDescriptions.clear();
      for (const ms of skills) {
        if (typeof ms.description === 'object') {
          this.marketplaceSkillDescriptions.set(ms.id, ms.description);
        }
      }
      this.marketplaceCache = { skills, tags };
      return this.marketplaceCache;
    } catch (error) {
      console.error('Failed to fetch marketplace skills:', error);
      return { skills: [], tags: [] };
    }
  }

  private async loadInstalledKitSkillDescriptions(): Promise<void> {
    this.installedKitSkillDescriptions.clear();
    try {
      const result = await window.electron.kits.listInstalled();
      if (!result.success || !result.installed) return;

      for (const kit of Object.values(result.installed)) {
        const metadata = kit.skills?.metadata ?? {};
        for (const [skillId, skillMetadata] of Object.entries(metadata)) {
          if (skillMetadata.description != null) {
            this.installedKitSkillDescriptions.set(skillId, skillMetadata.description);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load installed kit skill descriptions:', error);
    }
  }

  getLocalizedSkillDescription(skillId: string, skillName: string, fallback: string): string {
    const localDesc = this.localSkillDescriptions.get(skillName) ?? this.localSkillDescriptions.get(skillId);
    if (localDesc != null) return resolveLocalizedText(localDesc);
    const marketDesc = this.marketplaceSkillDescriptions.get(skillId);
    if (marketDesc != null) return resolveLocalizedText(marketDesc);
    const kitDesc = this.installedKitSkillDescriptions.get(skillId);
    if (kitDesc != null) return resolveLocalizedText(kitDesc);
    return resolveSkillDescriptionForDisplay({
      fallback,
      language: i18nService.getLanguage(),
      skillId,
      skillName,
    });
  }
}

export const skillService = new SkillService();

import type { MarketplaceKit } from '../types/kit';

class KitService {
  private marketplaceCache: MarketplaceKit[] | null = null;
  private fetchPromise: Promise<MarketplaceKit[]> | null = null;

  async fetchMarketplaceKits(): Promise<MarketplaceKit[]> {
    if (this.marketplaceCache) {
      return this.marketplaceCache;
    }
    if (this.fetchPromise) {
      return this.fetchPromise;
    }
    this.fetchPromise = this.loadMarketplaceKits();
    const result = await this.fetchPromise;
    this.fetchPromise = null;
    return result;
  }

  private async loadMarketplaceKits(): Promise<MarketplaceKit[]> {
    // TODO: Replace with real API call (similar to window.electron.skills.fetchMarketplace())
    // For now return mock data to demonstrate UI
    const mockKits: MarketplaceKit[] = [
      {
        id: 'design',
        name: 'Design',
        description: {
          en: 'Accelerate design workflows — critique, design system management, UX writing, accessibility audits, research synthesis, and dev handoff.',
          zh: '加速设计工作流 — 设计评审、设计系统管理、UX 文案、无障碍审计、研究综合与开发交接。',
        },
        author: 'Anthropic',
        downloadCount: '2.2M',
        tryAsking: [
          'Get structured feedback on a design',
          'Generate developer handoff specs from a Figma file',
          'Run a WCAG accessibility audit',
          'Write UX copy for a screen or flow',
          'Synthesize user research into actionable themes',
        ],
        skills: [
          { id: 'accessibility-review', name: '/accessibility-review' },
          { id: 'design-critique', name: '/design-critique' },
          { id: 'design-handoff', name: '/design-handoff' },
          { id: 'design-system', name: '/design-system' },
          { id: 'research-synthesis', name: '/research-synthesis' },
          { id: 'user-research', name: '/user-research' },
          { id: 'ux-copy', name: '/ux-copy' },
        ],
      },
      {
        id: 'marketing',
        name: 'Marketing',
        description: {
          en: 'Create content, plan campaigns, and analyze performance across marketing channels. Maintain brand voice.',
          zh: '创建内容、规划营销活动，并分析各营销渠道的表现。保持品牌调性。',
        },
        author: 'Anthropic',
        downloadCount: '2.2M',
        tryAsking: [
          'Write a blog post about our new feature',
          'Create a social media campaign plan',
          'Analyze our email marketing performance',
        ],
        skills: [
          { id: 'content-writer', name: '/content-writer' },
          { id: 'campaign-planner', name: '/campaign-planner' },
        ],
      },
      {
        id: 'productivity',
        name: 'Productivity',
        description: {
          en: 'Manage tasks, plan your day, and build up memory of important context about your work. Syncs with your...',
          zh: '管理任务、规划日程，并建立工作重要上下文的记忆。',
        },
        author: 'Anthropic',
        downloadCount: '2.3M',
        tryAsking: [
          'Help me plan my day',
          'Create a meeting summary',
          'Track my project milestones',
        ],
        skills: [
          { id: 'task-manager', name: '/task-manager' },
          { id: 'meeting-notes', name: '/meeting-notes' },
        ],
      },
      {
        id: 'engineering',
        name: 'Engineering',
        description: {
          en: 'Streamline engineering workflows — standups, code review, architecture decisions, incident response, and...',
          zh: '优化工程工作流 — 站会、代码审查、架构决策、事件响应等。',
        },
        author: 'Anthropic',
        downloadCount: '2.2M',
        tryAsking: [
          'Review this pull request',
          'Help me debug this error',
          'Design the architecture for a new service',
        ],
        skills: [
          { id: 'code-review', name: '/code-review' },
          { id: 'architecture', name: '/architecture' },
          { id: 'incident-response', name: '/incident-response' },
        ],
      },
      {
        id: 'data',
        name: 'Data',
        description: {
          en: 'Build SQL, explore datasets, and generate insights faster. Build visualizations and dashboards, and turn raw data in...',
          zh: '编写 SQL、探索数据集并更快生成洞察。构建可视化和仪表盘，将原始数据转化为...',
        },
        author: 'Anthropic',
        downloadCount: '2.3M',
        tryAsking: [
          'Write a SQL query to analyze user retention',
          'Build a dashboard for sales metrics',
        ],
        skills: [
          { id: 'sql-builder', name: '/sql-builder' },
          { id: 'data-viz', name: '/data-viz' },
        ],
      },
      {
        id: 'finance',
        name: 'Finance',
        description: {
          en: 'Streamline finance and accounting workflows, from journal entries and reconciliation to financial statements and...',
          zh: '简化财务和会计工作流，从日记账和对账到财务报表...',
        },
        author: 'Anthropic',
        downloadCount: '2.1M',
        tryAsking: [
          'Help me prepare a financial report',
          'Reconcile these accounts',
        ],
        skills: [
          { id: 'financial-report', name: '/financial-report' },
          { id: 'reconciliation', name: '/reconciliation' },
        ],
      },
      {
        id: 'product-management',
        name: 'Product Management',
        description: {
          en: 'Write feature specs, plan roadmaps, and synthesize user feedback faster. Keep stakeholders updated and stay...',
          zh: '编写功能规格、规划路线图，并更快综合用户反馈。保持利益相关者知情...',
        },
        author: 'Anthropic',
        downloadCount: '2.1M',
        tryAsking: [
          'Write a PRD for a new feature',
          'Create a product roadmap',
          'Summarize user feedback from surveys',
        ],
        skills: [
          { id: 'prd-writer', name: '/prd-writer' },
          { id: 'roadmap', name: '/roadmap' },
        ],
      },
      {
        id: 'operations',
        name: 'Operations',
        description: {
          en: 'Optimize business operations — vendor management, process documentation, change management, capacity...',
          zh: '优化业务运营 — 供应商管理、流程文档、变更管理、容量...',
        },
        author: 'Anthropic',
        downloadCount: '2.0M',
        tryAsking: [
          'Document our onboarding process',
          'Create a vendor evaluation matrix',
        ],
        skills: [
          { id: 'process-docs', name: '/process-docs' },
          { id: 'vendor-eval', name: '/vendor-eval' },
        ],
      },
    ];

    this.marketplaceCache = mockKits;
    return mockKits;
  }

  clearCache(): void {
    this.marketplaceCache = null;
  }
}

export const kitService = new KitService();

import {
  EnterpriseLeadAgentRole,
  type EnterpriseLeadAgentRole as EnterpriseLeadAgentRoleType,
  EnterpriseLeadContentPlatformId,
  EnterpriseLeadExtractionSourceKind,
  EnterpriseLeadResearchCapabilityId,
  EnterpriseLeadSkillCapabilityId,
  EnterpriseLeadTaskStatus,
  type EnterpriseLeadTaskStatus as EnterpriseLeadTaskStatusType,
  EnterpriseLeadWorkspaceType,
} from '../../../shared/enterpriseLeadWorkspace/constants';
import type {
  EnterpriseLeadAgentTask,
  EnterpriseLeadTaskAgentRole,
  EnterpriseLeadWorkspace,
  EnterpriseLeadWorkspaceAgentBinding,
  EnterpriseLeadWorkspaceDraft,
  EnterpriseLeadWorkspaceProfile,
  EnterpriseLeadWorkspaceRunSummary,
  EnterpriseLeadWorkspaceSettings,
  EnterpriseLeadWorkspaceSnapshot,
} from '../../../shared/enterpriseLeadWorkspace/types';

export const EnterpriseLeadWorkspaceLaunchMode = {
  FirstLaunch: 'first_launch',
  Returning: 'returning',
} as const;
export type EnterpriseLeadWorkspaceLaunchMode =
  typeof EnterpriseLeadWorkspaceLaunchMode[keyof typeof EnterpriseLeadWorkspaceLaunchMode];

export const EnterpriseLeadWorkspaceScreen = {
  Entry: 'entry',
  Create: 'create',
  Workspace: 'workspace',
} as const;
export type EnterpriseLeadWorkspaceScreen =
  typeof EnterpriseLeadWorkspaceScreen[keyof typeof EnterpriseLeadWorkspaceScreen];

export const WorkspaceCreateStartMode = {
  Material: 'material',
  Paste: 'paste',
  Blank: 'blank',
} as const;
export type WorkspaceCreateStartMode =
  typeof WorkspaceCreateStartMode[keyof typeof WorkspaceCreateStartMode];

export const WorkspaceCreateBranchScreen = {
  Material: 'setup-material',
  Paste: 'setup-paste',
  Blank: 'setup-blank',
} as const;
export type WorkspaceCreateBranchScreen =
  typeof WorkspaceCreateBranchScreen[keyof typeof WorkspaceCreateBranchScreen];

export const EnterpriseLeadWorkspaceShellMode = {
  Focused: 'focused',
  Workspace: 'workspace',
} as const;
export type EnterpriseLeadWorkspaceShellMode =
  typeof EnterpriseLeadWorkspaceShellMode[keyof typeof EnterpriseLeadWorkspaceShellMode];

export const EnterpriseLeadEntryAction = {
  Create: 'create',
  History: 'history',
} as const;
export type EnterpriseLeadEntryAction =
  typeof EnterpriseLeadEntryAction[keyof typeof EnterpriseLeadEntryAction];

export const EnterpriseLeadWorkspaceHistoryState = {
  Loading: 'loading',
  Empty: 'empty',
  Error: 'error',
  List: 'list',
} as const;
export type EnterpriseLeadWorkspaceHistoryState =
  typeof EnterpriseLeadWorkspaceHistoryState[keyof typeof EnterpriseLeadWorkspaceHistoryState];

export const EnterpriseLeadWorkspaceStartSourceState = {
  Material: 'material',
  Paste: 'paste',
  Blank: 'blank',
} as const;
export type EnterpriseLeadWorkspaceStartSourceState =
  typeof EnterpriseLeadWorkspaceStartSourceState[keyof typeof EnterpriseLeadWorkspaceStartSourceState];

export const EnterpriseLeadWorkspaceStartAction = {
  AddMaterial: 'add_material',
  ReviewProfile: 'review_profile',
  StartWorkflow: 'start_workflow',
} as const;
export type EnterpriseLeadWorkspaceStartAction =
  typeof EnterpriseLeadWorkspaceStartAction[keyof typeof EnterpriseLeadWorkspaceStartAction];

export const EnterpriseLeadWorkspaceStartReadinessStatus = {
  Ready: 'ready',
  Warning: 'warning',
  Optional: 'optional',
} as const;
export type EnterpriseLeadWorkspaceStartReadinessStatus =
  typeof EnterpriseLeadWorkspaceStartReadinessStatus[
    keyof typeof EnterpriseLeadWorkspaceStartReadinessStatus
  ];

export interface WorkspaceDraftSummaryLabels {
  productsFallback: string;
  customersFallback: string;
  targetCustomersPrefix: string;
}

export interface WorkspaceDraftSummary {
  name: string;
  products: string;
  targetCustomers: string;
}

export interface ManualWorkspaceDraftInput {
  name: string;
  mode: WorkspaceCreateStartMode;
  sourceLabel: string;
  sourceText?: string;
  settings?: EnterpriseLeadWorkspaceSettings;
}

export const EnterpriseLeadKnowledgeSection = {
  Company: 'company',
  Products: 'products',
  Customers: 'customers',
  Selling: 'selling',
  Rules: 'rules',
  Sources: 'sources',
  Deliverables: 'deliverables',
  Archives: 'archives',
} as const;
export type EnterpriseLeadKnowledgeSection =
  typeof EnterpriseLeadKnowledgeSection[keyof typeof EnterpriseLeadKnowledgeSection];

export const EnterpriseLeadKnowledgeItemKind = {
  CompanySummary: 'company_summary',
  Product: 'product',
  Capability: 'capability',
  Customer: 'customer',
  Scenario: 'scenario',
  SellingPoint: 'selling_point',
  Channel: 'channel',
  ProhibitedClaim: 'prohibited_claim',
  ContactRule: 'contact_rule',
  Source: 'source',
  Deliverable: 'deliverable',
  Archive: 'archive',
} as const;
export type EnterpriseLeadKnowledgeItemKind =
  typeof EnterpriseLeadKnowledgeItemKind[keyof typeof EnterpriseLeadKnowledgeItemKind];

export interface WorkspaceKnowledgeItem {
  id: string;
  kind: EnterpriseLeadKnowledgeItemKind;
  text: string;
  secondaryText?: string;
  metaText?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceKnowledgeSection {
  id: EnterpriseLeadKnowledgeSection;
  titleKey: string;
  emptyKey: string;
  items: WorkspaceKnowledgeItem[];
}

export interface EditableKnowledgeField {
  field: keyof EnterpriseLeadWorkspaceProfile;
  multiValue: boolean;
}

const editableKnowledgeFields: Partial<Record<EnterpriseLeadKnowledgeItemKind, EditableKnowledgeField>> = {
  [EnterpriseLeadKnowledgeItemKind.CompanySummary]: {
    field: 'companySummary',
    multiValue: false,
  },
  [EnterpriseLeadKnowledgeItemKind.Product]: {
    field: 'productList',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.Capability]: {
    field: 'productCapabilities',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.Customer]: {
    field: 'targetCustomers',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.Scenario]: {
    field: 'applicationScenarios',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.SellingPoint]: {
    field: 'sellingPoints',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.Channel]: {
    field: 'channelPreferences',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.ProhibitedClaim]: {
    field: 'prohibitedClaims',
    multiValue: true,
  },
  [EnterpriseLeadKnowledgeItemKind.ContactRule]: {
    field: 'contactRules',
    multiValue: true,
  },
};

export const getEditableKnowledgeField = (
  kind: EnterpriseLeadKnowledgeItemKind,
): EditableKnowledgeField | null => editableKnowledgeFields[kind] ?? null;

export const EnterpriseLeadCreationRecordMetric = {
  Tasks: 'tasks',
  Deliverables: 'deliverables',
  Todos: 'todos',
  Risks: 'risks',
} as const;
export type EnterpriseLeadCreationRecordMetric =
  typeof EnterpriseLeadCreationRecordMetric[keyof typeof EnterpriseLeadCreationRecordMetric];

export interface CreationRecordMetric {
  id: EnterpriseLeadCreationRecordMetric;
  count: number;
  labelKey: string;
}

export interface CreationRecordSummary {
  runId: string;
  goal: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  archiveStatus: string;
  participantCount: number;
  deliverableCount: number;
  todoCount: number;
  riskCount: number;
  meta: CreationRecordMetric[];
}

export interface WorkspaceEntryAction {
  id: EnterpriseLeadEntryAction;
  titleKey: string;
  descriptionKey: string;
  actionKey: string;
  tone: 'primary' | 'surface';
}

export interface WorkspaceHistoryStateInput {
  isLoading: boolean;
  error: string;
  workspaces: EnterpriseLeadWorkspace[];
}

type WorkspaceSummaryInput = Pick<EnterpriseLeadWorkspaceDraft, 'name' | 'profile'> |
  Pick<EnterpriseLeadWorkspace, 'name' | 'profile'>;

const COMPLETION_GROUP_COUNT = 6;

const cleanText = (value: string): string => value.trim();

const populatedValues = (values: string[]): string[] =>
  values.map(cleanText).filter(Boolean);

const hasText = (value: string): boolean => cleanText(value).length > 0;

const hasAny = (...groups: string[][]): boolean =>
  groups.some(group => populatedValues(group).length > 0);

export const getWorkspaceCreateBranchScreen = (
  mode: WorkspaceCreateStartMode,
): WorkspaceCreateBranchScreen => {
  if (mode === WorkspaceCreateStartMode.Paste) {
    return WorkspaceCreateBranchScreen.Paste;
  }

  if (mode === WorkspaceCreateStartMode.Blank) {
    return WorkspaceCreateBranchScreen.Blank;
  }

  return WorkspaceCreateBranchScreen.Material;
};

export const buildEmptyEnterpriseLeadWorkspaceProfile = (): EnterpriseLeadWorkspaceProfile => ({
  companySummary: '',
  productList: [],
  productCapabilities: [],
  targetCustomers: [],
  applicationScenarios: [],
  sellingPoints: [],
  channelPreferences: [],
  prohibitedClaims: [],
  contactRules: [],
  missingInfo: [],
});

export const buildManualEnterpriseLeadWorkspaceDraft = ({
  name,
  mode,
  sourceLabel,
  sourceText,
  settings,
}: ManualWorkspaceDraftInput): EnterpriseLeadWorkspaceDraft => {
  const trimmedName = cleanText(name);
  const trimmedSourceText = cleanText(sourceText ?? '');

  return {
    name: trimmedName || sourceLabel,
    type: EnterpriseLeadWorkspaceType.EnterpriseLead,
    profile: buildEmptyEnterpriseLeadWorkspaceProfile(),
    source: {
      kind: mode === WorkspaceCreateStartMode.Blank
        ? EnterpriseLeadExtractionSourceKind.Blank
        : EnterpriseLeadExtractionSourceKind.Manual,
      label: sourceLabel,
      text: trimmedSourceText || undefined,
    },
    enabledAgentRoles: [],
    settings,
    workspaceAgents: [],
  };
};

const toKnowledgeItems = (
  values: string[],
  kind: EnterpriseLeadKnowledgeItemKind,
  idPrefix: string,
): WorkspaceKnowledgeItem[] =>
  populatedValues(values).map((text, index) => ({
    id: `${idPrefix}-${index}`,
    kind,
    text,
  }));

const sortByRecentTimestamp = <T extends { createdAt?: string; updatedAt?: string }>(
  items: T[],
): T[] =>
  [...items].sort((a, b) => {
    const bTime = Date.parse(b.updatedAt ?? b.createdAt ?? '');
    const aTime = Date.parse(a.updatedAt ?? a.createdAt ?? '');
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });

export interface AgentRoleLabelMetadata {
  role: EnterpriseLeadAgentRoleType;
  titleKey: string;
  shortLabelKey: string;
  descriptionKey: string;
  inputKey: string;
  outputKey: string;
  safetyCritical: boolean;
}

export interface AgentCardTone {
  containerClassName: string;
  avatarClassName: string;
  statusClassName: string;
  actionClassName: string;
}

export interface AgentTaskDisplayMetadata {
  role: EnterpriseLeadTaskAgentRole;
  titleKey?: string;
  titleText: string;
  shortLabelKey?: string;
  shortLabelText: string;
  descriptionKey?: string;
  descriptionText: string;
  inputKey?: string;
  inputText: string;
  outputKey?: string;
  outputText: string;
  safetyCritical: boolean;
}

export const EnterpriseLeadWorkbenchNavItem = {
  Workbench: 'workbench',
  AiChat: 'ai_chat',
  Search: 'search',
  KnowledgeBase: 'knowledge_base',
  CreationRecords: 'creation_records',
  AgentManagement: 'agent_management',
  Settings: 'settings',
} as const;
export type EnterpriseLeadWorkbenchNavItem =
  typeof EnterpriseLeadWorkbenchNavItem[keyof typeof EnterpriseLeadWorkbenchNavItem];

export const EnterpriseLeadWorkspaceInternalPage = EnterpriseLeadWorkbenchNavItem;
export type EnterpriseLeadWorkspaceInternalPage =
  typeof EnterpriseLeadWorkspaceInternalPage[keyof typeof EnterpriseLeadWorkspaceInternalPage];

export const EnterpriseLeadWorkbenchNavIcon = {
  Dashboard: 'dashboard',
  Chat: 'chat',
  Search: 'search',
  Knowledge: 'knowledge',
  Records: 'records',
  Agents: 'agents',
  Settings: 'settings',
} as const;
export type EnterpriseLeadWorkbenchNavIcon =
  typeof EnterpriseLeadWorkbenchNavIcon[keyof typeof EnterpriseLeadWorkbenchNavIcon];

export const EnterpriseLeadWorkbenchSidebarMode = {
  Expanded: 'expanded',
  Collapsed: 'collapsed',
} as const;
export type EnterpriseLeadWorkbenchSidebarMode =
  typeof EnterpriseLeadWorkbenchSidebarMode[keyof typeof EnterpriseLeadWorkbenchSidebarMode];

export const EnterpriseLeadWorkbenchConfigSection = {
  Skills: 'skills',
  Research: 'research',
  Platforms: 'platforms',
} as const;
export type EnterpriseLeadWorkbenchConfigSection =
  typeof EnterpriseLeadWorkbenchConfigSection[keyof typeof EnterpriseLeadWorkbenchConfigSection];

export const EnterpriseLeadWorkbenchStatusTone = {
  Enabled: 'enabled',
  Warning: 'warning',
  Disabled: 'disabled',
  Configured: 'configured',
  Unconfigured: 'unconfigured',
  Add: 'add',
} as const;
export type EnterpriseLeadWorkbenchStatusTone =
  typeof EnterpriseLeadWorkbenchStatusTone[keyof typeof EnterpriseLeadWorkbenchStatusTone];

export const EnterpriseLeadWorkbenchMode = {
  Execution: 'execution',
  Agents: 'agents',
} as const;
export type EnterpriseLeadWorkbenchMode =
  typeof EnterpriseLeadWorkbenchMode[keyof typeof EnterpriseLeadWorkbenchMode];

export interface WorkbenchSidebarItem {
  id: EnterpriseLeadWorkbenchNavItem;
  icon: EnterpriseLeadWorkbenchNavIcon;
  labelKey: string;
}

export interface WorkspaceInternalPageMetadata {
  id: EnterpriseLeadWorkspaceInternalPage;
  icon: EnterpriseLeadWorkbenchNavIcon;
  labelKey: string;
}

export interface WorkspaceStartReadinessItem {
  id: string;
  labelKey: string;
  status: EnterpriseLeadWorkspaceStartReadinessStatus;
  statusKey: string;
}

export interface WorkbenchAgentItem {
  role: EnterpriseLeadAgentRoleType;
  roleLabelKey: string;
  capabilitySummaryKey: string;
  accentClassName: string;
  accentTextClassName: string;
}

export interface WorkbenchConfigItem {
  id: string;
  titleKey: string;
  descriptionKey: string;
  statusKey: string;
  markerKey?: string;
  tone: EnterpriseLeadWorkbenchStatusTone;
}

export interface WorkbenchConfigSection {
  id: EnterpriseLeadWorkbenchConfigSection;
  titleKey: string;
  descriptionKey: string;
  actionKey: string;
  items: WorkbenchConfigItem[];
}

export interface WorkbenchLayoutSpec {
  minimumContentWidth: number;
  sidebarWidth: number;
  expandedSidebarWidth: number;
  collapsedSidebarWidth: number;
  agentPanelMinWidth: number;
  configPanelMinWidth: number;
  configPanelMaxWidth: number;
  agentColumnCount: number;
  agentCardRowHeight: number;
  agentRowCount: number;
  configColumnCount: number;
  usesNestedScrollRegion: boolean;
}

export interface WorkspaceOperationToken {
  workspaceId: string;
  revision: number;
}

export type WorkspaceAgentTemplate = Pick<
  EnterpriseLeadWorkspaceAgentBinding['overrides'],
  'name' | 'description' | 'identity' | 'systemPrompt' | 'icon' | 'model' | 'skillIds'
> & {
  id: string;
  enabled?: boolean;
};

export interface EffectiveWorkspaceAgent {
  id: string;
  name: string;
  description: string;
  identity: string;
  systemPrompt: string;
  icon: string;
  model: string;
  skillIds: string[];
  enabled: boolean;
  order: number;
  missing: boolean;
}

export const getEffectiveWorkspaceAgent = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  globalAgent?: WorkspaceAgentTemplate | null,
): EffectiveWorkspaceAgent => {
  const overrides = binding.overrides ?? {};
  const overrideName = overrides.name?.trim();
  const directName = binding.name?.trim();
  const fallbackName = directName || globalAgent?.name?.trim() || binding.agentId;

  return {
    id: binding.agentId,
    name: overrideName || fallbackName,
    description: overrides.description?.trim() || binding.description || globalAgent?.description || '',
    identity: overrides.identity?.trim() || binding.identity || globalAgent?.identity || '',
    systemPrompt: overrides.systemPrompt?.trim() || binding.systemPrompt || globalAgent?.systemPrompt || '',
    icon: overrides.icon?.trim() || binding.icon || globalAgent?.icon || '',
    model: overrides.model?.trim() || binding.model || globalAgent?.model || '',
    skillIds: overrides.skillIds ?? binding.skillIds ?? globalAgent?.skillIds ?? [],
    enabled: binding.enabled,
    order: binding.order,
    missing: false,
  };
};

export const getWorkspaceAgentDisplayName = (
  binding: EnterpriseLeadWorkspaceAgentBinding,
  globalAgent?: WorkspaceAgentTemplate | null,
): string => getEffectiveWorkspaceAgent(binding, globalAgent).name;

const AGENT_ROLE_LABELS: Record<EnterpriseLeadAgentRoleType, AgentRoleLabelMetadata> = {
  [EnterpriseLeadAgentRole.Controller]: {
    role: EnterpriseLeadAgentRole.Controller,
    titleKey: 'enterpriseLeadAgentRoleControllerTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleControllerShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleControllerDescription',
    inputKey: 'enterpriseLeadAgentRoleControllerInput',
    outputKey: 'enterpriseLeadAgentRoleControllerOutput',
    safetyCritical: true,
  },
  [EnterpriseLeadAgentRole.ProductUnderstanding]: {
    role: EnterpriseLeadAgentRole.ProductUnderstanding,
    titleKey: 'enterpriseLeadAgentRoleProductUnderstandingTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleProductUnderstandingShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleProductUnderstandingDescription',
    inputKey: 'enterpriseLeadAgentRoleProductUnderstandingInput',
    outputKey: 'enterpriseLeadAgentRoleProductUnderstandingOutput',
    safetyCritical: false,
  },
  [EnterpriseLeadAgentRole.OpportunityRadar]: {
    role: EnterpriseLeadAgentRole.OpportunityRadar,
    titleKey: 'enterpriseLeadAgentRoleOpportunityRadarTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleOpportunityRadarShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleOpportunityRadarDescription',
    inputKey: 'enterpriseLeadAgentRoleOpportunityRadarInput',
    outputKey: 'enterpriseLeadAgentRoleOpportunityRadarOutput',
    safetyCritical: false,
  },
  [EnterpriseLeadAgentRole.ContentPlanning]: {
    role: EnterpriseLeadAgentRole.ContentPlanning,
    titleKey: 'enterpriseLeadAgentRoleContentPlanningTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleContentPlanningShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleContentPlanningDescription',
    inputKey: 'enterpriseLeadAgentRoleContentPlanningInput',
    outputKey: 'enterpriseLeadAgentRoleContentPlanningOutput',
    safetyCritical: false,
  },
  [EnterpriseLeadAgentRole.SocialOperation]: {
    role: EnterpriseLeadAgentRole.SocialOperation,
    titleKey: 'enterpriseLeadAgentRoleSocialOperationTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleSocialOperationShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleSocialOperationDescription',
    inputKey: 'enterpriseLeadAgentRoleSocialOperationInput',
    outputKey: 'enterpriseLeadAgentRoleSocialOperationOutput',
    safetyCritical: true,
  },
  [EnterpriseLeadAgentRole.SalesHandoff]: {
    role: EnterpriseLeadAgentRole.SalesHandoff,
    titleKey: 'enterpriseLeadAgentRoleSalesHandoffTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleSalesHandoffShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleSalesHandoffDescription',
    inputKey: 'enterpriseLeadAgentRoleSalesHandoffInput',
    outputKey: 'enterpriseLeadAgentRoleSalesHandoffOutput',
    safetyCritical: false,
  },
  [EnterpriseLeadAgentRole.RiskReview]: {
    role: EnterpriseLeadAgentRole.RiskReview,
    titleKey: 'enterpriseLeadAgentRoleRiskReviewTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleRiskReviewShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleRiskReviewDescription',
    inputKey: 'enterpriseLeadAgentRoleRiskReviewInput',
    outputKey: 'enterpriseLeadAgentRoleRiskReviewOutput',
    safetyCritical: true,
  },
  [EnterpriseLeadAgentRole.ProjectSummary]: {
    role: EnterpriseLeadAgentRole.ProjectSummary,
    titleKey: 'enterpriseLeadAgentRoleProjectSummaryTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleProjectSummaryShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleProjectSummaryDescription',
    inputKey: 'enterpriseLeadAgentRoleProjectSummaryInput',
    outputKey: 'enterpriseLeadAgentRoleProjectSummaryOutput',
    safetyCritical: false,
  },
  [EnterpriseLeadAgentRole.ProjectArchive]: {
    role: EnterpriseLeadAgentRole.ProjectArchive,
    titleKey: 'enterpriseLeadAgentRoleProjectArchiveTitle',
    shortLabelKey: 'enterpriseLeadAgentRoleProjectArchiveShortLabel',
    descriptionKey: 'enterpriseLeadAgentRoleProjectArchiveDescription',
    inputKey: 'enterpriseLeadAgentRoleProjectArchiveInput',
    outputKey: 'enterpriseLeadAgentRoleProjectArchiveOutput',
    safetyCritical: true,
  },
};

const WORKSPACE_ENTRY_ACTIONS: WorkspaceEntryAction[] = [
  {
    id: EnterpriseLeadEntryAction.Create,
    titleKey: 'enterpriseLeadEntryCreateTitle',
    descriptionKey: 'enterpriseLeadEntryCreateDesc',
    actionKey: 'enterpriseLeadEntryCreateAction',
    tone: 'primary',
  },
  {
    id: EnterpriseLeadEntryAction.History,
    titleKey: 'enterpriseLeadEntryHistoryTitle',
    descriptionKey: 'enterpriseLeadEntryHistoryDesc',
    actionKey: 'enterpriseLeadEntryHistoryAction',
    tone: 'surface',
  },
];

const WORKBENCH_SIDEBAR_ITEMS: WorkbenchSidebarItem[] = [
  {
    id: EnterpriseLeadWorkbenchNavItem.Workbench,
    icon: EnterpriseLeadWorkbenchNavIcon.Dashboard,
    labelKey: 'enterpriseLeadWorkbenchNavWorkbench',
  },
  {
    id: EnterpriseLeadWorkbenchNavItem.AiChat,
    icon: EnterpriseLeadWorkbenchNavIcon.Chat,
    labelKey: 'enterpriseLeadWorkbenchNavAiChat',
  },
  {
    id: EnterpriseLeadWorkbenchNavItem.Search,
    icon: EnterpriseLeadWorkbenchNavIcon.Search,
    labelKey: 'enterpriseLeadWorkbenchNavSearch',
  },
  {
    id: EnterpriseLeadWorkbenchNavItem.KnowledgeBase,
    icon: EnterpriseLeadWorkbenchNavIcon.Knowledge,
    labelKey: 'enterpriseLeadWorkbenchNavKnowledgeBase',
  },
  {
    id: EnterpriseLeadWorkbenchNavItem.CreationRecords,
    icon: EnterpriseLeadWorkbenchNavIcon.Records,
    labelKey: 'enterpriseLeadWorkbenchNavCreationRecords',
  },
  {
    id: EnterpriseLeadWorkbenchNavItem.AgentManagement,
    icon: EnterpriseLeadWorkbenchNavIcon.Agents,
    labelKey: 'enterpriseLeadWorkbenchNavAgentManagement',
  },
  {
    id: EnterpriseLeadWorkbenchNavItem.Settings,
    icon: EnterpriseLeadWorkbenchNavIcon.Settings,
    labelKey: 'enterpriseLeadWorkbenchNavSettings',
  },
];

const WORKBENCH_AGENT_ITEMS: WorkbenchAgentItem[] = [
  {
    role: EnterpriseLeadAgentRole.Controller,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentControllerRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentControllerCapabilitySummary',
    accentClassName: 'border-orange-500 bg-orange-50/45 dark:bg-orange-950/20',
    accentTextClassName: 'text-orange-700 dark:text-orange-300',
  },
  {
    role: EnterpriseLeadAgentRole.ProductUnderstanding,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentProductUnderstandingRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentProductUnderstandingCapabilitySummary',
    accentClassName: 'border-emerald-500 bg-emerald-50/55 dark:bg-emerald-950/20',
    accentTextClassName: 'text-emerald-700 dark:text-emerald-300',
  },
  {
    role: EnterpriseLeadAgentRole.OpportunityRadar,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentOpportunityRadarRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentOpportunityRadarCapabilitySummary',
    accentClassName: 'border-blue-500 bg-blue-50/55 dark:bg-blue-950/20',
    accentTextClassName: 'text-blue-700 dark:text-blue-300',
  },
  {
    role: EnterpriseLeadAgentRole.ContentPlanning,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentContentPlanningRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentContentPlanningCapabilitySummary',
    accentClassName: 'border-orange-500 bg-orange-50/45 dark:bg-orange-950/20',
    accentTextClassName: 'text-orange-700 dark:text-orange-300',
  },
  {
    role: EnterpriseLeadAgentRole.SocialOperation,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentSocialOperationRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentSocialOperationCapabilitySummary',
    accentClassName: 'border-purple-500 bg-purple-50/55 dark:bg-purple-950/20',
    accentTextClassName: 'text-purple-700 dark:text-purple-300',
  },
  {
    role: EnterpriseLeadAgentRole.SalesHandoff,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentSalesHandoffRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentSalesHandoffCapabilitySummary',
    accentClassName: 'border-indigo-500 bg-indigo-50/55 dark:bg-indigo-950/20',
    accentTextClassName: 'text-indigo-700 dark:text-indigo-300',
  },
  {
    role: EnterpriseLeadAgentRole.RiskReview,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentRiskReviewRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentRiskReviewCapabilitySummary',
    accentClassName: 'border-red-500 bg-red-50/50 dark:bg-red-950/20',
    accentTextClassName: 'text-red-700 dark:text-red-300',
  },
  {
    role: EnterpriseLeadAgentRole.ProjectSummary,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentProjectSummaryRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentProjectSummaryCapabilitySummary',
    accentClassName: 'border-slate-400 bg-slate-50/60 dark:bg-slate-900/25',
    accentTextClassName: 'text-slate-700 dark:text-slate-300',
  },
  {
    role: EnterpriseLeadAgentRole.ProjectArchive,
    roleLabelKey: 'enterpriseLeadWorkbenchAgentProjectArchiveRole',
    capabilitySummaryKey: 'enterpriseLeadWorkbenchAgentProjectArchiveCapabilitySummary',
    accentClassName: 'border-slate-400 bg-slate-50/60 dark:bg-slate-900/25',
    accentTextClassName: 'text-slate-700 dark:text-slate-300',
  },
];

const WORKBENCH_CONFIG_SECTIONS: WorkbenchConfigSection[] = [
  {
    id: EnterpriseLeadWorkbenchConfigSection.Skills,
    titleKey: 'enterpriseLeadWorkbenchSkillsTitle',
    descriptionKey: 'enterpriseLeadWorkbenchSkillsDesc',
    actionKey: 'enterpriseLeadWorkbenchManageSkills',
    items: [
      {
        id: EnterpriseLeadSkillCapabilityId.DocumentParsing,
        titleKey: 'enterpriseLeadWorkbenchSkillDocumentParsing',
        descriptionKey: 'enterpriseLeadWorkbenchSkillDocumentParsingDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusEnabled',
        tone: EnterpriseLeadWorkbenchStatusTone.Enabled,
      },
      {
        id: EnterpriseLeadSkillCapabilityId.CustomerProfile,
        titleKey: 'enterpriseLeadWorkbenchSkillCustomerProfile',
        descriptionKey: 'enterpriseLeadWorkbenchSkillCustomerProfileDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusEnabled',
        tone: EnterpriseLeadWorkbenchStatusTone.Enabled,
      },
      {
        id: EnterpriseLeadSkillCapabilityId.LeadFiltering,
        titleKey: 'enterpriseLeadWorkbenchSkillLeadFiltering',
        descriptionKey: 'enterpriseLeadWorkbenchSkillLeadFilteringDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusEnabled',
        tone: EnterpriseLeadWorkbenchStatusTone.Enabled,
      },
      {
        id: EnterpriseLeadSkillCapabilityId.ContentRewrite,
        titleKey: 'enterpriseLeadWorkbenchSkillContentRewrite',
        descriptionKey: 'enterpriseLeadWorkbenchSkillContentRewriteDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusPending',
        tone: EnterpriseLeadWorkbenchStatusTone.Warning,
      },
    ],
  },
  {
    id: EnterpriseLeadWorkbenchConfigSection.Research,
    titleKey: 'enterpriseLeadWorkbenchResearchTitle',
    descriptionKey: 'enterpriseLeadWorkbenchResearchDesc',
    actionKey: 'enterpriseLeadWorkbenchConfigureResearch',
    items: [
      {
        id: EnterpriseLeadResearchCapabilityId.WebSearch,
        titleKey: 'enterpriseLeadWorkbenchResearchWebSearch',
        descriptionKey: 'enterpriseLeadWorkbenchResearchWebSearchDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusEnabled',
        tone: EnterpriseLeadWorkbenchStatusTone.Enabled,
      },
      {
        id: EnterpriseLeadResearchCapabilityId.CompanyInfo,
        titleKey: 'enterpriseLeadWorkbenchResearchCompanyInfo',
        descriptionKey: 'enterpriseLeadWorkbenchResearchCompanyInfoDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusEnabled',
        tone: EnterpriseLeadWorkbenchStatusTone.Enabled,
      },
      {
        id: EnterpriseLeadResearchCapabilityId.SocialTrend,
        titleKey: 'enterpriseLeadWorkbenchResearchSocialTrend',
        descriptionKey: 'enterpriseLeadWorkbenchResearchSocialTrendDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusLoginRequired',
        tone: EnterpriseLeadWorkbenchStatusTone.Warning,
      },
      {
        id: EnterpriseLeadResearchCapabilityId.HiringSignal,
        titleKey: 'enterpriseLeadWorkbenchResearchHiringSignal',
        descriptionKey: 'enterpriseLeadWorkbenchResearchHiringSignalDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusDisabled',
        tone: EnterpriseLeadWorkbenchStatusTone.Disabled,
      },
    ],
  },
  {
    id: EnterpriseLeadWorkbenchConfigSection.Platforms,
    titleKey: 'enterpriseLeadWorkbenchPlatformsTitle',
    descriptionKey: 'enterpriseLeadWorkbenchPlatformsDesc',
    actionKey: 'enterpriseLeadWorkbenchManagePlatforms',
    items: [
      {
        id: EnterpriseLeadContentPlatformId.Xiaohongshu,
        titleKey: 'enterpriseLeadWorkbenchPlatformXiaohongshu',
        descriptionKey: 'enterpriseLeadWorkbenchPlatformXiaohongshuDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusConfigured',
        markerKey: 'enterpriseLeadWorkbenchPlatformXiaohongshuMarker',
        tone: EnterpriseLeadWorkbenchStatusTone.Configured,
      },
      {
        id: EnterpriseLeadContentPlatformId.Douyin,
        titleKey: 'enterpriseLeadWorkbenchPlatformDouyin',
        descriptionKey: 'enterpriseLeadWorkbenchPlatformDouyinDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusUnconfigured',
        markerKey: 'enterpriseLeadWorkbenchPlatformDouyinMarker',
        tone: EnterpriseLeadWorkbenchStatusTone.Unconfigured,
      },
      {
        id: EnterpriseLeadContentPlatformId.Kuaishou,
        titleKey: 'enterpriseLeadWorkbenchPlatformKuaishou',
        descriptionKey: 'enterpriseLeadWorkbenchPlatformKuaishouDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusUnconfigured',
        markerKey: 'enterpriseLeadWorkbenchPlatformKuaishouMarker',
        tone: EnterpriseLeadWorkbenchStatusTone.Unconfigured,
      },
      {
        id: EnterpriseLeadContentPlatformId.WechatOfficial,
        titleKey: 'enterpriseLeadWorkbenchPlatformWechatOfficial',
        descriptionKey: 'enterpriseLeadWorkbenchPlatformWechatOfficialDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusConfigured',
        markerKey: 'enterpriseLeadWorkbenchPlatformWechatOfficialMarker',
        tone: EnterpriseLeadWorkbenchStatusTone.Configured,
      },
      {
        id: EnterpriseLeadContentPlatformId.Wecom,
        titleKey: 'enterpriseLeadWorkbenchPlatformWecom',
        descriptionKey: 'enterpriseLeadWorkbenchPlatformWecomDesc',
        statusKey: 'enterpriseLeadWorkbenchStatusConfigured',
        markerKey: 'enterpriseLeadWorkbenchPlatformWecomMarker',
        tone: EnterpriseLeadWorkbenchStatusTone.Configured,
      },
    ],
  },
];

const WORKBENCH_LAYOUT_SPEC: WorkbenchLayoutSpec = {
  minimumContentWidth: 1168,
  sidebarWidth: 196,
  expandedSidebarWidth: 196,
  collapsedSidebarWidth: 76,
  agentPanelMinWidth: 552,
  configPanelMinWidth: 388,
  configPanelMaxWidth: 460,
  agentColumnCount: 3,
  agentCardRowHeight: 136,
  agentRowCount: 3,
  configColumnCount: 1,
  usesNestedScrollRegion: true,
};

const DEFAULT_AGENT_CARD_ACTION =
  'bg-primary text-white hover:bg-primary/90 focus:ring-primary/30';

const AGENT_CARD_TONES: Record<EnterpriseLeadTaskStatusType, AgentCardTone> = {
  [EnterpriseLeadTaskStatus.Waiting]: {
    containerClassName: 'border-border bg-surface',
    avatarClassName: 'bg-surface-raised text-secondary',
    statusClassName: 'bg-surface-raised text-secondary',
    actionClassName: DEFAULT_AGENT_CARD_ACTION,
  },
  [EnterpriseLeadTaskStatus.Running]: {
    containerClassName: 'border-primary/40 bg-primary/5',
    avatarClassName: 'bg-primary/10 text-primary',
    statusClassName: 'bg-primary/10 text-primary',
    actionClassName: DEFAULT_AGENT_CARD_ACTION,
  },
  [EnterpriseLeadTaskStatus.Completed]: {
    containerClassName: 'border-emerald-400/40 bg-emerald-500/5',
    avatarClassName: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    statusClassName: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    actionClassName: DEFAULT_AGENT_CARD_ACTION,
  },
  [EnterpriseLeadTaskStatus.NeedsInput]: {
    containerClassName: 'border-amber-400/50 bg-amber-500/5',
    avatarClassName: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    statusClassName: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    actionClassName: DEFAULT_AGENT_CARD_ACTION,
  },
  [EnterpriseLeadTaskStatus.Blocked]: {
    containerClassName: 'border-orange-400/50 bg-orange-500/5',
    avatarClassName: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
    statusClassName: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
    actionClassName: DEFAULT_AGENT_CARD_ACTION,
  },
  [EnterpriseLeadTaskStatus.Error]: {
    containerClassName: 'border-red-400/50 bg-red-500/5',
    avatarClassName: 'bg-red-500/10 text-red-700 dark:text-red-300',
    statusClassName: 'bg-red-500/10 text-red-700 dark:text-red-300',
    actionClassName: 'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500/30',
  },
  [EnterpriseLeadTaskStatus.Stale]: {
    containerClassName: 'border-amber-400/70 bg-amber-500/10',
    avatarClassName: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
    statusClassName: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
    actionClassName: 'bg-amber-600 text-white hover:bg-amber-700 focus:ring-amber-500/30',
  },
};

const AGENT_STATUS_LABEL_KEYS: Record<EnterpriseLeadTaskStatusType, string> = {
  [EnterpriseLeadTaskStatus.Waiting]: 'enterpriseLeadAgentStatusWaiting',
  [EnterpriseLeadTaskStatus.Running]: 'enterpriseLeadAgentStatusRunning',
  [EnterpriseLeadTaskStatus.Completed]: 'enterpriseLeadAgentStatusCompleted',
  [EnterpriseLeadTaskStatus.NeedsInput]: 'enterpriseLeadAgentStatusNeedsInput',
  [EnterpriseLeadTaskStatus.Blocked]: 'enterpriseLeadAgentStatusBlocked',
  [EnterpriseLeadTaskStatus.Error]: 'enterpriseLeadAgentStatusError',
  [EnterpriseLeadTaskStatus.Stale]: 'enterpriseLeadAgentStatusStale',
};

export const getLaunchMode = (
  workspaces: EnterpriseLeadWorkspace[],
): EnterpriseLeadWorkspaceLaunchMode =>
  workspaces.length === 0
    ? EnterpriseLeadWorkspaceLaunchMode.FirstLaunch
    : EnterpriseLeadWorkspaceLaunchMode.Returning;

export const getEntryHomeActions = (): WorkspaceEntryAction[] =>
  WORKSPACE_ENTRY_ACTIONS.map(action => ({ ...action }));

export const getShellModeForEnterpriseLeadWorkspaceScreen = (
  screen: EnterpriseLeadWorkspaceScreen,
): EnterpriseLeadWorkspaceShellMode =>
  screen === EnterpriseLeadWorkspaceScreen.Workspace
    ? EnterpriseLeadWorkspaceShellMode.Workspace
    : EnterpriseLeadWorkspaceShellMode.Focused;

export const shouldRefreshHistoryOnEntryAction = (
  actionId: EnterpriseLeadEntryAction,
): boolean => actionId === EnterpriseLeadEntryAction.History;

export const sortWorkspacesByRecentUpdate = (
  workspaces: EnterpriseLeadWorkspace[],
): EnterpriseLeadWorkspace[] =>
  [...workspaces].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

export const getHistoryModalState = ({
  isLoading,
  error,
  workspaces,
}: WorkspaceHistoryStateInput): EnterpriseLeadWorkspaceHistoryState => {
  if (isLoading) {
    return EnterpriseLeadWorkspaceHistoryState.Loading;
  }

  if (error.trim()) {
    return EnterpriseLeadWorkspaceHistoryState.Error;
  }

  if (workspaces.length === 0) {
    return EnterpriseLeadWorkspaceHistoryState.Empty;
  }

  return EnterpriseLeadWorkspaceHistoryState.List;
};

export const getWorkspaceCompletionPercent = (
  profile: EnterpriseLeadWorkspaceProfile,
): number => {
  const completedGroups = [
    hasText(profile.companySummary),
    hasAny(profile.productList, profile.productCapabilities),
    hasAny(profile.targetCustomers, profile.applicationScenarios),
    hasAny(profile.channelPreferences),
    hasAny(profile.sellingPoints),
    hasAny(profile.prohibitedClaims, profile.contactRules),
  ].filter(Boolean).length;

  return Math.round((completedGroups / COMPLETION_GROUP_COUNT) * 100);
};

export const summarizeWorkspaceDraft = (
  draft: WorkspaceSummaryInput,
  labels: WorkspaceDraftSummaryLabels,
): WorkspaceDraftSummary => {
  const products = populatedValues(draft.profile.productList).join(', ');
  const customers = populatedValues(draft.profile.targetCustomers).join(', ');

  return {
    name: cleanText(draft.name),
    products: products || labels.productsFallback,
    targetCustomers: `${labels.targetCustomersPrefix}${customers || labels.customersFallback}`,
  };
};

export const getWorkspaceKnowledgeSections = (
  workspace: EnterpriseLeadWorkspace,
  snapshot: EnterpriseLeadWorkspaceSnapshot | null,
): WorkspaceKnowledgeSection[] => {
  const profile = workspace.profile;
  const sourceItems: WorkspaceKnowledgeItem[] = workspace.extractionSources
    .flatMap((source, index): WorkspaceKnowledgeItem[] => {
      const label = cleanText(source.label) || cleanText(source.filePath ?? '') ||
        cleanText(source.kind);

      if (!label) {
        return [];
      }

      return [{
        id: `source-${index}`,
        kind: EnterpriseLeadKnowledgeItemKind.Source,
        text: label,
        secondaryText: cleanText(source.filePath ?? '') || undefined,
        metaText: cleanText(source.kind),
      }];
    });
  const deliverableItems: WorkspaceKnowledgeItem[] = sortByRecentTimestamp(
    snapshot?.deliverables ?? [],
  ).map(deliverable => ({
    id: deliverable.id,
    kind: EnterpriseLeadKnowledgeItemKind.Deliverable,
    text: cleanText(deliverable.title) || cleanText(deliverable.summary),
    secondaryText: cleanText(deliverable.summary) || undefined,
    metaText: deliverable.status,
    createdAt: deliverable.createdAt,
    updatedAt: deliverable.updatedAt,
  })).filter(item => item.text);
  const archiveItems: WorkspaceKnowledgeItem[] = sortByRecentTimestamp(
    snapshot?.archives ?? [],
  ).map(archive => ({
    id: archive.id,
    kind: EnterpriseLeadKnowledgeItemKind.Archive,
    text: cleanText(archive.title) || cleanText(archive.summary),
    secondaryText: cleanText(archive.summary) || undefined,
    createdAt: archive.createdAt,
  })).filter(item => item.text);

  return [
    {
      id: EnterpriseLeadKnowledgeSection.Company,
      titleKey: 'enterpriseLeadKnowledgeCompanyTitle',
      emptyKey: 'enterpriseLeadKnowledgeCompanyEmpty',
      items: cleanText(profile.companySummary)
        ? [{
            id: 'company-summary',
            kind: EnterpriseLeadKnowledgeItemKind.CompanySummary,
            text: cleanText(profile.companySummary),
          }]
        : [],
    },
    {
      id: EnterpriseLeadKnowledgeSection.Products,
      titleKey: 'enterpriseLeadKnowledgeProductsTitle',
      emptyKey: 'enterpriseLeadKnowledgeProductsEmpty',
      items: [
        ...toKnowledgeItems(
          profile.productList,
          EnterpriseLeadKnowledgeItemKind.Product,
          'product',
        ),
        ...toKnowledgeItems(
          profile.productCapabilities,
          EnterpriseLeadKnowledgeItemKind.Capability,
          'capability',
        ),
      ],
    },
    {
      id: EnterpriseLeadKnowledgeSection.Customers,
      titleKey: 'enterpriseLeadKnowledgeCustomersTitle',
      emptyKey: 'enterpriseLeadKnowledgeCustomersEmpty',
      items: [
        ...toKnowledgeItems(
          profile.targetCustomers,
          EnterpriseLeadKnowledgeItemKind.Customer,
          'customer',
        ),
        ...toKnowledgeItems(
          profile.applicationScenarios,
          EnterpriseLeadKnowledgeItemKind.Scenario,
          'scenario',
        ),
      ],
    },
    {
      id: EnterpriseLeadKnowledgeSection.Selling,
      titleKey: 'enterpriseLeadKnowledgeSellingTitle',
      emptyKey: 'enterpriseLeadKnowledgeSellingEmpty',
      items: [
        ...toKnowledgeItems(
          profile.sellingPoints,
          EnterpriseLeadKnowledgeItemKind.SellingPoint,
          'selling-point',
        ),
        ...toKnowledgeItems(
          profile.channelPreferences,
          EnterpriseLeadKnowledgeItemKind.Channel,
          'channel',
        ),
      ],
    },
    {
      id: EnterpriseLeadKnowledgeSection.Rules,
      titleKey: 'enterpriseLeadKnowledgeRulesTitle',
      emptyKey: 'enterpriseLeadKnowledgeRulesEmpty',
      items: [
        ...toKnowledgeItems(
          profile.prohibitedClaims,
          EnterpriseLeadKnowledgeItemKind.ProhibitedClaim,
          'prohibited-claim',
        ),
        ...toKnowledgeItems(
          profile.contactRules,
          EnterpriseLeadKnowledgeItemKind.ContactRule,
          'contact-rule',
        ),
      ],
    },
    {
      id: EnterpriseLeadKnowledgeSection.Sources,
      titleKey: 'enterpriseLeadKnowledgeSourcesTitle',
      emptyKey: 'enterpriseLeadKnowledgeSourcesEmpty',
      items: sourceItems,
    },
    {
      id: EnterpriseLeadKnowledgeSection.Deliverables,
      titleKey: 'enterpriseLeadKnowledgeDeliverablesTitle',
      emptyKey: 'enterpriseLeadKnowledgeDeliverablesEmpty',
      items: deliverableItems,
    },
    {
      id: EnterpriseLeadKnowledgeSection.Archives,
      titleKey: 'enterpriseLeadKnowledgeArchivesTitle',
      emptyKey: 'enterpriseLeadKnowledgeArchivesEmpty',
      items: archiveItems,
    },
  ];
};

export const getCreationRecordSummary = (
  summary: EnterpriseLeadWorkspaceRunSummary,
): CreationRecordSummary => ({
  runId: summary.run.id,
  goal: cleanText(summary.run.userGoal),
  status: summary.run.status,
  createdAt: summary.run.createdAt,
  updatedAt: summary.run.updatedAt,
  archiveStatus: summary.run.archiveStatus,
  participantCount: summary.taskCount,
  deliverableCount: summary.deliverableCount,
  todoCount: summary.todoCount,
  riskCount: summary.riskCount,
  meta: [
    {
      id: EnterpriseLeadCreationRecordMetric.Tasks,
      count: summary.taskCount,
      labelKey: 'enterpriseLeadCreationRecordMetricTasks',
    },
    {
      id: EnterpriseLeadCreationRecordMetric.Deliverables,
      count: summary.deliverableCount,
      labelKey: 'enterpriseLeadCreationRecordMetricDeliverables',
    },
    {
      id: EnterpriseLeadCreationRecordMetric.Todos,
      count: summary.todoCount,
      labelKey: 'enterpriseLeadCreationRecordMetricTodos',
    },
    {
      id: EnterpriseLeadCreationRecordMetric.Risks,
      count: summary.riskCount,
      labelKey: 'enterpriseLeadCreationRecordMetricRisks',
    },
  ],
});

export const getAgentRoleLabel = (
  role: EnterpriseLeadAgentRoleType,
): AgentRoleLabelMetadata => AGENT_ROLE_LABELS[role];

const isEnterpriseLeadAgentRole = (role: EnterpriseLeadTaskAgentRole): role is EnterpriseLeadAgentRoleType =>
  Object.values(EnterpriseLeadAgentRole).includes(role as EnterpriseLeadAgentRoleType);

const getDynamicAgentShortLabel = (value: string): string => {
  const text = cleanText(value);
  if (!text) {
    return 'A';
  }
  const firstCodePoint = Array.from(text)[0];
  return firstCodePoint?.toUpperCase() ?? 'A';
};

export const getEnterpriseLeadTaskDisplay = (
  taskOrRole: Pick<EnterpriseLeadAgentTask, 'role' | 'agentSnapshot'> | EnterpriseLeadTaskAgentRole,
): AgentTaskDisplayMetadata => {
  const role = typeof taskOrRole === 'string' ? taskOrRole : taskOrRole.role;
  const snapshot = typeof taskOrRole === 'string' ? null : taskOrRole.agentSnapshot;

  if (snapshot) {
    const title = cleanText(snapshot.name) || role;
    const description = cleanText(snapshot.description) || cleanText(snapshot.identity) ||
      title;

    return {
      role,
      titleText: title,
      shortLabelText: getDynamicAgentShortLabel(snapshot.icon || title),
      descriptionText: description,
      inputText: '',
      outputText: title,
      safetyCritical: /risk|review|audit|风险|风控|审核|合规/i.test([
        role,
        snapshot.name,
        snapshot.description,
        snapshot.identity,
      ].join(' ')),
    };
  }

  if (isEnterpriseLeadAgentRole(role)) {
    const roleLabel = getAgentRoleLabel(role);
    return {
      role,
      titleKey: roleLabel.titleKey,
      titleText: role,
      shortLabelKey: roleLabel.shortLabelKey,
      shortLabelText: role,
      descriptionKey: roleLabel.descriptionKey,
      descriptionText: '',
      inputKey: roleLabel.inputKey,
      inputText: '',
      outputKey: roleLabel.outputKey,
      outputText: '',
      safetyCritical: roleLabel.safetyCritical,
    };
  }

  return {
    role,
    titleText: role,
    shortLabelText: getDynamicAgentShortLabel(role),
    descriptionText: role,
    inputText: '',
    outputText: role,
    safetyCritical: false,
  };
};

export const getWorkbenchSidebarItems = (): WorkbenchSidebarItem[] =>
  WORKBENCH_SIDEBAR_ITEMS.map(item => ({ ...item }));

export const getWorkspaceInternalPages = (): WorkspaceInternalPageMetadata[] =>
  getWorkbenchSidebarItems().map(item => ({
    id: item.id,
    icon: item.icon,
    labelKey: item.labelKey,
  }));

export const getDefaultWorkspaceInternalPage = (): EnterpriseLeadWorkspaceInternalPage =>
  EnterpriseLeadWorkspaceInternalPage.Workbench;

const hasWorkspaceProfileContent = (profile: EnterpriseLeadWorkspaceProfile): boolean =>
  profile.companySummary.trim().length > 0 ||
  profile.productList.length > 0 ||
  profile.productCapabilities.length > 0 ||
  profile.targetCustomers.length > 0 ||
  profile.applicationScenarios.length > 0 ||
  profile.sellingPoints.length > 0 ||
  profile.channelPreferences.length > 0 ||
  profile.prohibitedClaims.length > 0 ||
  profile.contactRules.length > 0;

const hasWorkspaceRulesContent = (profile: EnterpriseLeadWorkspaceProfile): boolean =>
  profile.channelPreferences.length > 0 ||
  profile.prohibitedClaims.length > 0 ||
  profile.contactRules.length > 0;

export const getWorkspaceStartSourceState = (
  workspace: EnterpriseLeadWorkspace,
): EnterpriseLeadWorkspaceStartSourceState => {
  const sourceKind = workspace.extractionSources[0]?.kind;

  if (sourceKind === EnterpriseLeadExtractionSourceKind.File) {
    return EnterpriseLeadWorkspaceStartSourceState.Material;
  }

  if (
    sourceKind === EnterpriseLeadExtractionSourceKind.Manual ||
    sourceKind === EnterpriseLeadExtractionSourceKind.Conversation
  ) {
    return EnterpriseLeadWorkspaceStartSourceState.Paste;
  }

  return EnterpriseLeadWorkspaceStartSourceState.Blank;
};

export const getWorkspaceStartReadiness = (
  workspace: EnterpriseLeadWorkspace,
): WorkspaceStartReadinessItem[] => {
  const sourceState = getWorkspaceStartSourceState(workspace);
  const hasSource = sourceState !== EnterpriseLeadWorkspaceStartSourceState.Blank;
  const hasProfile = hasWorkspaceProfileContent(workspace.profile);
  const hasRules = hasWorkspaceRulesContent(workspace.profile);

  return [
    {
      id: 'material',
      labelKey: 'enterpriseLeadStartReadinessMaterial',
      status: hasSource
        ? EnterpriseLeadWorkspaceStartReadinessStatus.Ready
        : EnterpriseLeadWorkspaceStartReadinessStatus.Warning,
      statusKey: hasSource
        ? 'enterpriseLeadStartReadinessReady'
        : 'enterpriseLeadStartReadinessMissing',
    },
    {
      id: 'profile',
      labelKey: 'enterpriseLeadStartReadinessProfile',
      status: hasProfile
        ? EnterpriseLeadWorkspaceStartReadinessStatus.Ready
        : EnterpriseLeadWorkspaceStartReadinessStatus.Warning,
      statusKey: hasProfile
        ? 'enterpriseLeadStartReadinessGenerated'
        : 'enterpriseLeadStartReadinessPending',
    },
    {
      id: 'rules',
      labelKey: 'enterpriseLeadStartReadinessRules',
      status: hasRules
        ? EnterpriseLeadWorkspaceStartReadinessStatus.Ready
        : EnterpriseLeadWorkspaceStartReadinessStatus.Optional,
      statusKey: hasRules
        ? 'enterpriseLeadStartReadinessReady'
        : 'enterpriseLeadStartReadinessOptional',
    },
    {
      id: 'settings',
      labelKey: 'enterpriseLeadStartReadinessSettings',
      status: EnterpriseLeadWorkspaceStartReadinessStatus.Optional,
      statusKey: 'enterpriseLeadStartReadinessOptional',
    },
  ];
};

export const getWorkspaceStartActionTarget = (
  action: EnterpriseLeadWorkspaceStartAction,
  sourceState: EnterpriseLeadWorkspaceStartSourceState,
): EnterpriseLeadWorkspaceInternalPage => {
  if (action === EnterpriseLeadWorkspaceStartAction.StartWorkflow) {
    return sourceState === EnterpriseLeadWorkspaceStartSourceState.Blank
      ? EnterpriseLeadWorkspaceInternalPage.KnowledgeBase
      : EnterpriseLeadWorkspaceInternalPage.AiChat;
  }

  return EnterpriseLeadWorkspaceInternalPage.KnowledgeBase;
};

export const getDefaultWorkbenchSidebarMode = (): EnterpriseLeadWorkbenchSidebarMode =>
  EnterpriseLeadWorkbenchSidebarMode.Expanded;

export const getWorkbenchSidebarWidth = (
  mode: EnterpriseLeadWorkbenchSidebarMode,
): number => (
  mode === EnterpriseLeadWorkbenchSidebarMode.Collapsed
    ? WORKBENCH_LAYOUT_SPEC.collapsedSidebarWidth
    : WORKBENCH_LAYOUT_SPEC.expandedSidebarWidth
);

export const getWorkbenchAgentItems = (): WorkbenchAgentItem[] =>
  WORKBENCH_AGENT_ITEMS.map(item => ({ ...item }));

export const getWorkbenchConfigSections = (): WorkbenchConfigSection[] =>
  WORKBENCH_CONFIG_SECTIONS.map(section => ({
    ...section,
    items: section.items.map(item => ({ ...item })),
  }));

export const getWorkbenchLayoutSpec = (): WorkbenchLayoutSpec =>
  WORKBENCH_LAYOUT_SPEC;

export const getAgentCardTone = (
  status: EnterpriseLeadTaskStatusType | string,
): AgentCardTone =>
  AGENT_CARD_TONES[status as EnterpriseLeadTaskStatusType] ??
  AGENT_CARD_TONES[EnterpriseLeadTaskStatus.Waiting];

export const getAgentStatusLabelKey = (
  status: EnterpriseLeadTaskStatusType | string,
  stale = false,
): string => {
  if (stale) {
    return AGENT_STATUS_LABEL_KEYS[EnterpriseLeadTaskStatus.Stale];
  }

  return AGENT_STATUS_LABEL_KEYS[status as EnterpriseLeadTaskStatusType] ??
    AGENT_STATUS_LABEL_KEYS[EnterpriseLeadTaskStatus.Waiting];
};

export const hasTaskOutput = (
  task: Pick<EnterpriseLeadAgentTask, 'summary' | 'outputPayload'>,
): boolean =>
  hasText(task.summary) || Object.keys(task.outputPayload ?? {}).length > 0;

export const isWorkspaceOperationCurrent = (
  token: WorkspaceOperationToken,
  currentWorkspaceId: string,
  currentRevision: number,
  isMounted: boolean,
): boolean =>
  isMounted &&
  token.workspaceId === currentWorkspaceId &&
  token.revision === currentRevision;

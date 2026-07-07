import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { i18nService } from '../../services/i18n';
import { EnterpriseLeadWorkspaceInternalPage } from './enterpriseLeadWorkspaceUi';

const LIST_LIMIT = 8;

export const EnterpriseLeadCoworkHandoffTarget = {
  Embedded: 'embedded',
} as const;

export type EnterpriseLeadCoworkHandoffTarget =
  (typeof EnterpriseLeadCoworkHandoffTarget)[keyof typeof EnterpriseLeadCoworkHandoffTarget];

export interface EnterpriseLeadCoworkHandoffRequest {
  target: EnterpriseLeadCoworkHandoffTarget;
  nextInternalPage: typeof EnterpriseLeadWorkspaceInternalPage.AiChat;
  draft: string;
}

const cleanText = (value: string | null | undefined): string =>
  value?.trim().replace(/\s+/g, ' ') ?? '';

const formatLabel = (labelKey: string, value: string): string =>
  `${i18nService.t(labelKey)}${i18nService.t('enterpriseLeadCoworkDraftPromptLabelSeparator')}${value}`;

const formatText = (value: string | null | undefined): string =>
  cleanText(value) || i18nService.t('enterpriseLeadCoworkDraftPromptMissingValue');

const formatList = (items: string[] | undefined): string => {
  const values = (items ?? []).map(cleanText).filter(Boolean).slice(0, LIST_LIMIT);

  return values.length > 0
    ? values.join(i18nService.t('enterpriseLeadCoworkDraftPromptListSeparator'))
    : i18nService.t('enterpriseLeadCoworkDraftPromptMissingValue');
};

const interpolate = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (nextTemplate, [key, value]) => nextTemplate.split(`{${key}}`).join(value),
    template,
  );

export const buildEnterpriseLeadCoworkDraftPrompt = (
  workspace: EnterpriseLeadWorkspace,
): string => {
  const profile = workspace.profile;
  const lines = [
    `# ${i18nService.t('enterpriseLeadCoworkDraftPromptHeader')}`,
    interpolate(i18nService.t('enterpriseLeadCoworkDraftPromptIntro'), {
      name: formatText(workspace.name),
    }),
    '',
    formatLabel(
      'enterpriseLeadCoworkDraftPromptCompanySummary',
      formatText(profile.companySummary),
    ),
    formatLabel('enterpriseLeadCoworkDraftPromptProducts', formatList(profile.productList)),
    formatLabel(
      'enterpriseLeadCoworkDraftPromptCapabilities',
      formatList(profile.productCapabilities),
    ),
    formatLabel(
      'enterpriseLeadCoworkDraftPromptTargetCustomers',
      formatList(profile.targetCustomers),
    ),
    formatLabel(
      'enterpriseLeadCoworkDraftPromptScenarios',
      formatList(profile.applicationScenarios),
    ),
    formatLabel('enterpriseLeadCoworkDraftPromptSellingPoints', formatList(profile.sellingPoints)),
    formatLabel('enterpriseLeadCoworkDraftPromptContactRules', formatList(profile.contactRules)),
    formatLabel(
      'enterpriseLeadCoworkDraftPromptProhibitedClaims',
      formatList(profile.prohibitedClaims),
    ),
    '',
    i18nService.t('enterpriseLeadCoworkDraftPromptAsk'),
  ];

  return lines.join('\n');
};

export const buildEnterpriseLeadCoworkHandoffRequest = (
  _workspace: EnterpriseLeadWorkspace,
): EnterpriseLeadCoworkHandoffRequest => ({
  target: EnterpriseLeadCoworkHandoffTarget.Embedded,
  nextInternalPage: EnterpriseLeadWorkspaceInternalPage.AiChat,
  draft: '',
});

import { describe, expect, test } from 'vitest';

import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';
import { buildDefaultEnterpriseLeadWorkspaceSettings } from '../../../shared/enterpriseLeadWorkspace/validation';
import {
  buildEnterpriseLeadCoworkDraftPrompt,
  buildEnterpriseLeadCoworkHandoffRequest,
  EnterpriseLeadCoworkHandoffTarget,
} from './workspaceCoworkHandoff';

const createWorkspace = (): EnterpriseLeadWorkspace => ({
  id: 'workspace-1',
  name: '华东制造拓客计划',
  type: 'enterprise_lead',
  profile: {
    companySummary: '主营工业视觉检测设备，服务长三角制造业客户。',
    productList: ['视觉检测机', '产线自动化改造'],
    productCapabilities: ['缺陷识别', '产线集成'],
    targetCustomers: ['汽车零部件厂', '精密五金厂'],
    applicationScenarios: ['出厂质检', '在线巡检'],
    sellingPoints: ['交付快', '可按产线定制'],
    channelPreferences: ['微信私信', '电话邀约'],
    prohibitedClaims: ['不要承诺百分百良率'],
    contactRules: ['先确认产线类型再推荐方案'],
    missingInfo: [],
  },
  extractionSources: [],
  riskRules: [],
  enabledAgentRoles: [],
  settings: buildDefaultEnterpriseLeadWorkspaceSettings(),
  workspaceAgents: [],
  recentRunId: null,
  createdAt: '2026-07-06T00:00:00.000Z',
  updatedAt: '2026-07-06T00:00:00.000Z',
});

describe('buildEnterpriseLeadCoworkDraftPrompt', () => {
  test('builds a Cowork draft with enterprise lead workspace context', () => {
    const prompt = buildEnterpriseLeadCoworkDraftPrompt(createWorkspace());

    expect(prompt).toContain('华东制造拓客计划');
    expect(prompt).toContain('主营工业视觉检测设备');
    expect(prompt).toContain('视觉检测机、产线自动化改造');
    expect(prompt).toContain('汽车零部件厂、精密五金厂');
    expect(prompt).toContain('请基于以上企业获客工作台上下文继续帮我推进');
    expect(prompt).not.toContain('undefined');
  });

  test('targets the embedded Cowork surface without default textarea content', () => {
    const request = buildEnterpriseLeadCoworkHandoffRequest(createWorkspace());

    expect(request.target).toBe(EnterpriseLeadCoworkHandoffTarget.Embedded);
    expect(request.nextInternalPage).toBe('ai_chat');
    expect(request.draft).toBe('');
  });
});

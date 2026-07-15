import type { EnterpriseLeadWorkspace } from '../../../shared/enterpriseLeadWorkspace/types';

export const getWorkspaceDefaultKitIds = (
  workspace?: Pick<EnterpriseLeadWorkspace, 'settings'> | null,
): string[] => workspace?.settings.kitIds ?? [];

export const mergeWorkspaceKitIds = (
  defaultKitIds: string[],
  selectedKitIds: string[],
): string[] => Array.from(new Set<string>([...defaultKitIds, ...selectedKitIds]));

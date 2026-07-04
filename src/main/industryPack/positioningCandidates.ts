import type { LoadedIndustryPack } from './industryPackLoader';

interface IndustryPackProduct {
  id: string;
  name?: string;
  keywords?: string[];
  useCases?: string[];
  sellingPoints?: string[];
}

export interface PositioningCandidateDirection {
  id: string;
  name: string;
  keywords: string[];
  useCases: string[];
  sellingPoints: string[];
  source: 'product' | 'solution';
}

export interface BuildPositioningCandidatesOptions {
  requestedDirectionIds?: string[];
}

const SOLUTION_DIRECTIONS: PositioningCandidateDirection[] = [
  {
    id: 'solution_auto_parts_packaging',
    name: '汽配零部件包装方案',
    keywords: ['汽配包装', '汽车零部件包装', '重型纸箱'],
    useCases: ['汽车零部件', '五金模具', '长途运输'],
    sellingPoints: ['防破损', '按重量尺寸定制', '适合批量供货'],
    source: 'solution',
  },
  {
    id: 'solution_machinery_equipment_packaging',
    name: '机械设备包装方案',
    keywords: ['机械设备包装', '设备运输包装', '重型包装'],
    useCases: ['机械设备', '电机设备', '大件产品'],
    sellingPoints: ['结构加固', '替代木箱', '运输防护'],
    source: 'solution',
  },
  {
    id: 'solution_export_packaging',
    name: '出口免熏蒸包装方案',
    keywords: ['出口免熏蒸包装', '替代木箱', '纸托盘'],
    useCases: ['出口货物', '项目制发货', '跨境运输'],
    sellingPoints: ['免熏蒸', '降低木材成本', '交期更灵活'],
    source: 'solution',
  },
  {
    id: 'solution_large_product_transportation',
    name: '大件产品运输包装方案',
    keywords: ['大件产品包装', '重货包装', '防破损运输'],
    useCases: ['大件产品', '异形件', '仓储周转'],
    sellingPoints: ['防边角压伤', '适配装卸场景', '支持内衬护角组合'],
    source: 'solution',
  },
];

const isProduct = (value: unknown): value is IndustryPackProduct =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && typeof (value as IndustryPackProduct).id === 'string';

const cleanList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim())
    : [];

export function buildPositioningCandidates(
  pack: LoadedIndustryPack,
  options: BuildPositioningCandidatesOptions = {},
): PositioningCandidateDirection[] {
  const products = Array.isArray(pack.products) ? pack.products : [];
  const productCandidates = products
    .filter(isProduct)
    .map(product => ({
      id: product.id.trim(),
      name: product.name?.trim() || product.id.trim(),
      keywords: cleanList(product.keywords),
      useCases: cleanList(product.useCases),
      sellingPoints: cleanList(product.sellingPoints),
      source: 'product' as const,
    }));

  const allCandidates = [...productCandidates, ...SOLUTION_DIRECTIONS];
  const requestedIds = new Set(options.requestedDirectionIds?.map(id => id.trim()).filter(Boolean));

  if (requestedIds.size === 0) {
    return allCandidates;
  }

  return allCandidates.filter(candidate => requestedIds.has(candidate.id));
}

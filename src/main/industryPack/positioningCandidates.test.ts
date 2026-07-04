import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { IndustryPackId } from '../../shared/industryPack/constants';
import { IndustryPackLoader } from './industryPackLoader';
import { buildPositioningCandidates } from './positioningCandidates';

describe('buildPositioningCandidates', () => {
  test('uses bundled products and solution directions from the heavy packaging pack', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);

    const candidates = buildPositioningCandidates(pack);

    expect(candidates.map(candidate => candidate.id)).toEqual(expect.arrayContaining([
      'heavy_corrugated_carton',
      'honeycomb_carton',
      'paper_edge_protector',
      'paper_pallet',
      'wooden_box_replacement',
      'solution_auto_parts_packaging',
      'solution_machinery_equipment_packaging',
      'solution_export_packaging',
      'solution_large_product_transportation',
    ]));
    expect(candidates.find(candidate => candidate.id === 'wooden_box_replacement')).toMatchObject({
      name: '替代木箱包装',
      keywords: expect.arrayContaining(['替代木箱']),
    });
  });

  test('narrows candidates when requested product ids are provided', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });
    const pack = loader.getPack(IndustryPackId.HeavyPackaging);

    const candidates = buildPositioningCandidates(pack, {
      requestedDirectionIds: ['paper_pallet', 'wooden_box_replacement'],
    });

    expect(candidates.map(candidate => candidate.id)).toEqual([
      'paper_pallet',
      'wooden_box_replacement',
    ]);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { IndustryPackChannel, IndustryPackId } from '../../shared/industryPack/constants';
import { IndustryPackLoader } from './industryPackLoader';

const writeJson = (filePath: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeText = (filePath: string, value: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
};

const createTempPacksRoot = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'industry-packs-'));

const createValidPack = (
  packsRoot: string,
  packId = IndustryPackId.HeavyPackaging,
): string => {
  const packDir = path.join(packsRoot, packId);

  writeJson(path.join(packDir, 'manifest.json'), {
    id: packId,
    name: '重型包装获客内容包',
    version: '1.0.0',
    category: 'manufacturing-marketing',
    description: '用于重型纸箱、蜂窝纸箱、纸托盘、纸护角等工业包装企业的国内推广内容生成。',
    locale: 'zh-CN',
    entryTasks: ['generate_content_package'],
    supportedChannels: ['wechat_moments'],
    supportedThemes: ['anti_damage'],
    supportedTones: ['boss'],
    defaultOutputSchemas: ['content-package'],
  });
  writeJson(path.join(packDir, 'fields.json'), { groups: [{ id: 'factory', fields: [] }] });
  writeJson(path.join(packDir, 'products.json'), []);
  writeJson(path.join(packDir, 'tasks.json'), [{ id: 'generate_content_package' }]);
  writeJson(path.join(packDir, 'themes.json'), [{ id: 'anti_damage' }]);
  writeJson(path.join(packDir, 'tones.json'), [{ id: 'boss' }]);
  writeJson(path.join(packDir, 'output-schemas/content-package.json'), { type: 'object' });
  writeText(path.join(packDir, 'channels/wechat-moments.md'), '# 朋友圈规则\n');

  return packDir;
};

describe('IndustryPackLoader', () => {
  test('loads the bundled heavy packaging pack', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });

    const pack = loader.getPack(IndustryPackId.HeavyPackaging);

    expect(pack.manifest.id).toBe(IndustryPackId.HeavyPackaging);
    expect(pack.manifest.name).toContain('重型包装');
    expect(pack.fields.groups.length).toBeGreaterThan(0);
    expect(pack.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'heavy_corrugated_carton' }),
        expect.objectContaining({ id: 'paper_pallet' }),
      ]),
    );
    expect(pack.channels[IndustryPackChannel.WechatMoments]).toContain('朋友圈');
    expect(pack.channels[IndustryPackChannel.Platform1688]).toContain('1688');
    expect(pack.outputSchemas['content-package']).toEqual(expect.objectContaining({ type: 'object' }));
    expect(pack.examples.replace_wooden_box).toContain('木箱');
  });

  test('lists bundled packs in display order', () => {
    const loader = new IndustryPackLoader({
      packsRoot: path.resolve(process.cwd(), 'resources/industry-packs'),
    });

    expect(loader.listPacks().map(pack => pack.id)).toEqual([IndustryPackId.HeavyPackaging]);
  });

  test('rejects pack ids that contain traversal segments', () => {
    const packsRoot = createTempPacksRoot();
    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack('../heavy-packaging')).toThrow(
      'Invalid industry pack id "../heavy-packaging": path traversal is not allowed',
    );
  });

  test('rejects pack ids that escape the packs root', () => {
    const packsRoot = createTempPacksRoot();
    const loader = new IndustryPackLoader({ packsRoot });
    const escapedPackDir = path.join(createTempPacksRoot(), IndustryPackId.HeavyPackaging);

    expect(() => loader.getPack(escapedPackDir)).toThrow(
      `Invalid industry pack id "${escapedPackDir}": path escapes packs root`,
    );
  });

  test('rejects manifests whose id does not match the requested pack id', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot, IndustryPackId.HeavyPackaging);
    writeJson(path.join(packDir, 'manifest.json'), {
      id: 'other-pack',
      name: '重型包装获客内容包',
      version: '1.0.0',
      category: 'manufacturing-marketing',
      description: '用于重型纸箱、蜂窝纸箱、纸托盘、纸护角等工业包装企业的国内推广内容生成。',
      locale: 'zh-CN',
      entryTasks: ['generate_content_package'],
      supportedChannels: ['wechat_moments'],
      supportedThemes: ['anti_damage'],
      supportedTones: ['boss'],
      defaultOutputSchemas: ['content-package'],
    });

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(
      'manifest.id "other-pack" does not match requested pack id "heavy-packaging"',
    );
  });

  test('rejects packs missing channel rules required by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    fs.unlinkSync(path.join(packDir, 'channels/wechat-moments.md'));

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(
      'Missing channel rule for manifest.supportedChannels "wechat_moments"',
    );
  });

  test('rejects packs missing output schemas required by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    fs.unlinkSync(path.join(packDir, 'output-schemas/content-package.json'));

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(
      'Missing output schema for manifest.defaultOutputSchemas "content-package"',
    );
  });

  test('rejects malformed task files linked by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    writeJson(path.join(packDir, 'tasks.json'), { id: 'generate_content_package' });

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(
      'tasks.json must be an array of objects with non-empty string id',
    );
  });

  test('rejects missing task ids linked by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    writeJson(path.join(packDir, 'tasks.json'), [{ id: 'generate_case_content' }]);

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(/Missing task.*tasks\.json/);
  });

  test('rejects malformed theme entries linked by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    writeJson(path.join(packDir, 'themes.json'), [{ id: '' }]);

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(
      'themes.json must be an array of objects with non-empty string id',
    );
  });

  test('rejects missing theme ids linked by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    writeJson(path.join(packDir, 'themes.json'), [{ id: 'replace_wooden_box' }]);

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(/Missing theme.*themes\.json/);
  });

  test('rejects missing tone ids linked by the manifest', () => {
    const packsRoot = createTempPacksRoot();
    const packDir = createValidPack(packsRoot);
    writeJson(path.join(packDir, 'tones.json'), [{ id: 'professional_sales' }]);

    const loader = new IndustryPackLoader({ packsRoot });

    expect(() => loader.getPack(IndustryPackId.HeavyPackaging)).toThrow(
      'Missing tone for manifest.supportedTones "boss" in tones.json',
    );
  });
});

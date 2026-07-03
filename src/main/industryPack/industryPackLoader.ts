import fs from 'node:fs';
import path from 'node:path';

import type { IndustryPackManifest } from '../../shared/industryPack/types';
import { validateIndustryPackManifest } from '../../shared/industryPack/validation';

interface IndustryPackLoaderOptions {
  packsRoot: string;
}

interface IndustryPackFields {
  groups: unknown[];
}

interface ObjectWithId {
  id: string;
}

export interface LoadedIndustryPack {
  id: string;
  manifest: IndustryPackManifest;
  fields: IndustryPackFields;
  products: unknown;
  themes: unknown;
  tones: unknown;
  tasks: unknown;
  channels: Record<string, string>;
  outputSchemas: Record<string, unknown>;
  examples: Record<string, string>;
}

export interface IndustryPackListItem {
  id: string;
  name: string;
  version: string;
}

export class IndustryPackLoader {
  constructor(private readonly options: IndustryPackLoaderOptions) {}

  listPacks(): IndustryPackListItem[] {
    const packsRoot = this.resolvePacksRoot();

    return fs.readdirSync(packsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.getPack(entry.name))
      .sort((left, right) => left.manifest.name.localeCompare(right.manifest.name, 'zh-CN'))
      .map(pack => ({
        id: pack.manifest.id,
        name: pack.manifest.name,
        version: pack.manifest.version,
      }));
  }

  getPack(packId: string): LoadedIndustryPack {
    const packDir = this.resolvePackDir(packId);
    const manifest = this.readJson<IndustryPackManifest>(path.join(packDir, 'manifest.json'));
    const validation = validateIndustryPackManifest(manifest);

    if (!validation.ok) {
      throw new Error(`Invalid industry pack ${packId}: ${validation.errors.join('; ')}`);
    }

    if (manifest.id !== packId) {
      throw new Error(
        `Invalid industry pack ${packId}: manifest.id "${manifest.id}" does not match requested pack id "${packId}"`,
      );
    }

    const fields = this.readJson<IndustryPackFields>(path.join(packDir, 'fields.json'));
    const products = this.readOptionalJson(path.join(packDir, 'products.json'), []);
    const themes = this.readOptionalJson(path.join(packDir, 'themes.json'), []);
    const tones = this.readOptionalJson(path.join(packDir, 'tones.json'), []);
    const tasks = this.readOptionalJson(path.join(packDir, 'tasks.json'), []);
    const channels = this.readMarkdownDirectory(path.join(packDir, 'channels'));
    const outputSchemas = this.readJsonDirectory(path.join(packDir, 'output-schemas'));

    this.validatePackIntegrity(packId, {
      manifest,
      fields,
      themes,
      tones,
      tasks,
      channels,
      outputSchemas,
    });

    return {
      id: manifest.id,
      manifest,
      fields,
      products,
      themes,
      tones,
      tasks,
      channels,
      outputSchemas,
      examples: this.readMarkdownDirectory(path.join(packDir, 'examples')),
    };
  }

  private resolvePacksRoot(): string {
    return path.resolve(this.options.packsRoot);
  }

  private resolvePackDir(packId: string): string {
    const packsRoot = this.resolvePacksRoot();
    const packIdSegments = packId.split(/[\\/]+/);

    if (packIdSegments.includes('..')) {
      throw new Error(`Invalid industry pack id "${packId}": path traversal is not allowed`);
    }

    const packDir = path.resolve(packsRoot, packId);
    const relativePackDir = path.relative(packsRoot, packDir);

    if (
      !packId ||
      path.isAbsolute(packId) ||
      relativePackDir === '..' ||
      relativePackDir.startsWith(`..${path.sep}`)
    ) {
      throw new Error(`Invalid industry pack id "${packId}": path escapes packs root`);
    }

    return packDir;
  }

  private readJson<T>(filePath: string): T {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  }

  private readOptionalJson<T>(filePath: string, fallback: T): T {
    if (!fs.existsSync(filePath)) return fallback;
    return this.readJson<T>(filePath);
  }

  private readJsonDirectory(dirPath: string): Record<string, unknown> {
    if (!fs.existsSync(dirPath)) return {};

    return Object.fromEntries(
      fs.readdirSync(dirPath)
        .filter(fileName => fileName.endsWith('.json'))
        .sort()
        .map(fileName => [
          path.basename(fileName, '.json'),
          this.readJson(path.join(dirPath, fileName)),
        ]),
    );
  }

  private readMarkdownDirectory(dirPath: string): Record<string, string> {
    if (!fs.existsSync(dirPath)) return {};

    return Object.fromEntries(
      fs.readdirSync(dirPath)
        .filter(fileName => fileName.endsWith('.md'))
        .sort()
        .map(fileName => [
          path.basename(fileName, '.md').replaceAll('-', '_'),
          fs.readFileSync(path.join(dirPath, fileName), 'utf8'),
        ]),
    );
  }

  private validatePackIntegrity(
    packId: string,
    pack: {
      manifest: IndustryPackManifest;
      fields: IndustryPackFields;
      themes: unknown;
      tones: unknown;
      tasks: unknown;
      channels: Record<string, string>;
      outputSchemas: Record<string, unknown>;
    },
  ): void {
    if (!Array.isArray(pack.fields.groups)) {
      throw new Error(`Invalid industry pack ${packId}: fields.json must include a groups array`);
    }

    this.assertRecordContainsAll(
      packId,
      pack.channels,
      pack.manifest.supportedChannels,
      'channel rule',
      'manifest.supportedChannels',
    );
    this.assertRecordContainsAll(
      packId,
      pack.outputSchemas,
      pack.manifest.defaultOutputSchemas,
      'output schema',
      'manifest.defaultOutputSchemas',
    );
    this.assertObjectArrayContainsAll(
      packId,
      pack.tasks,
      pack.manifest.entryTasks,
      'task',
      'manifest.entryTasks',
      'tasks.json',
    );
    this.assertObjectArrayContainsAll(
      packId,
      pack.themes,
      pack.manifest.supportedThemes,
      'theme',
      'manifest.supportedThemes',
      'themes.json',
    );
    this.assertObjectArrayContainsAll(
      packId,
      pack.tones,
      pack.manifest.supportedTones,
      'tone',
      'manifest.supportedTones',
      'tones.json',
    );
  }

  private assertRecordContainsAll(
    packId: string,
    record: Record<string, unknown>,
    requiredIds: string[],
    itemLabel: string,
    manifestField: string,
  ): void {
    for (const requiredId of requiredIds) {
      if (!(requiredId in record)) {
        throw new Error(
          `Invalid industry pack ${packId}: Missing ${itemLabel} for ${manifestField} "${requiredId}"`,
        );
      }
    }
  }

  private assertObjectArrayContainsAll(
    packId: string,
    value: unknown,
    requiredIds: string[],
    itemLabel: string,
    manifestField: string,
    fileName: string,
  ): void {
    if (!this.isObjectWithNonEmptyIdArray(value)) {
      throw new Error(
        `Invalid industry pack ${packId}: ${fileName} must be an array of objects with non-empty string id`,
      );
    }

    const availableIds = new Set(value.map(item => item.id));
    for (const requiredId of requiredIds) {
      if (!availableIds.has(requiredId)) {
        throw new Error(
          `Invalid industry pack ${packId}: Missing ${itemLabel} for ${manifestField} "${requiredId}" in ${fileName}`,
        );
      }
    }
  }

  private isObjectWithNonEmptyIdArray(value: unknown): value is ObjectWithId[] {
    return Array.isArray(value)
      && value.every(item => (
        Boolean(item)
        && typeof item === 'object'
        && 'id' in item
        && typeof item.id === 'string'
        && item.id.trim().length > 0
      ));
  }
}

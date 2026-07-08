import fs from 'fs';
import path from 'path';

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

const parseEnvFile = (raw: string): Record<string, string> => {
  const config: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim().toUpperCase();
    if (!ENV_KEY_PATTERN.test(key)) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    config[key] = value;
  }
  return config;
};

const formatEnvValue = (key: string, value: string): string => {
  if (value.includes('#') || value.includes(' ') || value.includes('"') || value.includes("'")) {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${key}="${escaped}"`;
  }
  return `${key}=${value}`;
};

export class SharedCredentialStore {
  private memoryConfig: Record<string, string> = {};

  constructor(private readonly filePath: string) {}

  getAll(): Record<string, string> {
    if (this.filePath === ':memory:') {
      return { ...this.memoryConfig };
    }
    if (!fs.existsSync(this.filePath)) {
      return {};
    }
    try {
      return parseEnvFile(fs.readFileSync(this.filePath, 'utf8'));
    } catch {
      return {};
    }
  }

  getMany(keys: Iterable<string>): Record<string, string> {
    const all = this.getAll();
    const result: Record<string, string> = {};
    for (const rawKey of keys) {
      const key = rawKey.trim().toUpperCase();
      const value = all[key]?.trim();
      if (!ENV_KEY_PATTERN.test(key) || !value) continue;
      result[key] = value;
    }
    return result;
  }

  setMany(values: Record<string, string>): void {
    const next = this.getAll();
    for (const [rawKey, rawValue] of Object.entries(values)) {
      const key = rawKey.trim().toUpperCase();
      if (!ENV_KEY_PATTERN.test(key)) continue;
      const value = rawValue.trim();
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
    }
    this.saveAll(next);
  }

  private saveAll(config: Record<string, string>): void {
    const entries = Object.entries(config)
      .filter(([key, value]) => ENV_KEY_PATTERN.test(key) && value.trim())
      .sort(([a], [b]) => a.localeCompare(b));

    if (this.filePath === ':memory:') {
      this.memoryConfig = Object.fromEntries(entries);
      return;
    }

    if (entries.length === 0) {
      if (fs.existsSync(this.filePath)) {
        fs.unlinkSync(this.filePath);
      }
      return;
    }

    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(
      this.filePath,
      entries.map(([key, value]) => formatEnvValue(key, value)).join('\n') + '\n',
      'utf8',
    );
  }
}

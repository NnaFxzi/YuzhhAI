const fs = require('node:fs');
const path = require('node:path');

const roots = [
  'electron-builder.json',
  'package.json',
  'README.md',
  'README_zh.md',
  'scripts',
  'src/main',
  'src/renderer',
  'src/shared',
];

const ignoredPathParts = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}dist-electron${path.sep}`,
  `${path.sep}release${path.sep}`,
  `${path.sep}vendor${path.sep}`,
  `${path.sep}scripts${path.sep}patches${path.sep}`,
];

const forbiddenRules = [
  {
    pattern: /Resources\/cfmind|resources[\\/]+cfmind/g,
    message: 'Packaged runtime path must use yuzhh-runtime, not cfmind.',
  },
  {
    pattern: /"to":\s*"cfmind"|prefix:\s*['"]cfmind['"]/g,
    message: 'Packaged runtime destination must be yuzhh-runtime.',
  },
  {
    pattern: /unpack-cfmind\.cjs/g,
    message: 'Packaged Windows extractor must use unpack-yuzhh-runtime.cjs.',
  },
  {
    pattern: /lobsterai-server\.youdao|api-overmind\.youdao|rlogs\.youdao/g,
    message: 'Legacy Youdao/LobsterAI cloud endpoints must stay disabled.',
  },
  {
    pattern: /OpenClaw 运行时（cfmind）|OpenClaw runtime \(cfmind\)/g,
    message: 'User-facing runtime text must not expose cfmind.',
  },
];

function shouldIgnore(filePath) {
  const normalized = path.normalize(filePath);
  if (normalized.endsWith(path.normalize('scripts/check-release-branding.cjs'))) {
    return true;
  }
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalized)) {
    return true;
  }
  return ignoredPathParts.some(part => normalized.includes(part));
}

function walk(target) {
  if (!fs.existsSync(target) || shouldIgnore(target)) return [];
  const stat = fs.statSync(target);
  if (stat.isFile()) return [target];

  return fs.readdirSync(target).flatMap((entry) => {
    if (['node_modules', 'dist', 'dist-electron', 'release', 'vendor'].includes(entry)) {
      return [];
    }
    return walk(path.join(target, entry));
  });
}

let failed = false;

for (const file of roots.flatMap(walk)) {
  const content = fs.readFileSync(file, 'utf8');

  for (const rule of forbiddenRules) {
    if (rule.pattern.test(content)) {
      console.error(`${file}: ${rule.message}`);
      failed = true;
    }
    rule.pattern.lastIndex = 0;
  }
}

if (failed) {
  process.exit(1);
}

console.log('Release branding scan passed.');

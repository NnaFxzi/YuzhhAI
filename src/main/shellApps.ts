import { execFile, spawn } from 'child_process';
import { app, shell } from 'electron';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AppInfo {
  name: string;
  path: string;
  isDefault: boolean;
  bundleId?: string;
  icon?: string;
  iconPath?: string;
}

const appCache = new Map<string, AppInfo[]>();

export async function getAppsForFile(filePath: string): Promise<AppInfo[]> {
  const ext = path.extname(filePath).toLowerCase();
  if (!ext) return [];

  const cached = appCache.get(ext);
  if (cached) return cached;

  let apps: AppInfo[] = [];
  try {
    switch (process.platform) {
      case 'darwin':
        apps = await getApps_macOS(filePath);
        break;
      case 'win32':
        apps = await getApps_windows(ext);
        break;
      case 'linux':
        apps = await getApps_linux(filePath);
        break;
    }
  } catch (err) {
    console.warn('[ShellApps] failed to get apps:', err);
  }

  apps = curateApps(apps, ext);

  await fetchIcons(apps);
  for (const a of apps) {
    delete a.iconPath;
  }

  if (apps.length > 0) {
    appCache.set(ext, apps);
  }
  return apps;
}

const MAX_APPS_IN_LIST = 5;
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

// Bundle IDs / name fragments that are rarely useful for opening documents.
const EXCLUDED_BUNDLE_IDS = new Set<string>([
  'com.google.Chrome',
  'com.google.Chrome.canary',
  'com.google.chrome.for.testing',
  'org.chromium.Chromium',
  'com.apple.Safari',
  'com.microsoft.edgemac',
  'com.brave.Browser',
  'company.thebrowser.Browser', // Arc
  'com.bytedance.macos.doubao',
  'com.bytedance.macos.doubao.browser',
  'com.apple.Notes',
  'com.apple.iCal',
]);
const EXCLUDED_NAME_PATTERNS = [
  /chrome/i, /chromium/i, /safari/i, /firefox/i, /edge$/i, /brave/i,
  /doubao/i, /browser$/i,
];

const BROWSER_BUNDLE_IDS = new Set<string>([
  'com.google.Chrome',
  'com.google.Chrome.canary',
  'com.google.chrome.for.testing',
  'org.chromium.Chromium',
  'com.apple.Safari',
  'org.mozilla.firefox',
  'com.microsoft.edgemac',
  'com.brave.Browser',
  'company.thebrowser.Browser',
  'company.thebrowser.dia',
  'com.operasoftware.Opera',
  'com.vivaldi.Vivaldi',
  'com.360.Chrome',
  'com.tencent.LemonBrowser',
  'com.bytedance.macos.doubao.browser',
]);
const BROWSER_NAME_PATTERNS = [
  /chrome/i,
  /chromium/i,
  /safari/i,
  /firefox/i,
  /microsoft edge/i,
  /^edge$/i,
  /brave/i,
  /^arc$/i,
  /\bdia\b/i,
  /opera/i,
  /vivaldi/i,
  /browser/i,
  /浏览器/i,
];

// Office-class keywords grouped by file family.
const SPREADSHEET_KEYWORDS = [
  'microsoft excel', 'excel', 'numbers',
  'wps spreadsheet', 'wps表格', 'wps office',
  'libreoffice calc', 'libre office calc', 'openoffice calc',
];
const WORD_PROCESSOR_KEYWORDS = [
  'microsoft word', 'word', 'pages',
  'wps writer', 'wps文字', 'wps office',
  'libreoffice writer', 'libre office writer', 'openoffice writer',
];
const PRESENTATION_KEYWORDS = [
  'microsoft powerpoint', 'powerpoint', 'keynote',
  'wps presentation', 'wps演示', 'wps office',
  'libreoffice impress', 'libre office impress', 'openoffice impress',
];
const PDF_KEYWORDS = [
  'preview', '预览', 'adobe acrobat', 'adobe reader',
  'pdf expert', 'skim', 'foxit',
];

const MARKDOWN_KEYWORDS = [
  'typora', 'obsidian', 'macdown', 'marktext', 'mark text',
  'bear', 'mou', 'ia writer', 'byword', 'logseq',
];

const EXT_OFFICE_KEYWORDS: Record<string, string[]> = {
  '.csv': SPREADSHEET_KEYWORDS,
  '.tsv': SPREADSHEET_KEYWORDS,
  '.xls': SPREADSHEET_KEYWORDS,
  '.xlsx': SPREADSHEET_KEYWORDS,
  '.doc': WORD_PROCESSOR_KEYWORDS,
  '.docx': WORD_PROCESSOR_KEYWORDS,
  '.ppt': PRESENTATION_KEYWORDS,
  '.pptx': PRESENTATION_KEYWORDS,
  '.pdf': PDF_KEYWORDS,
  '.md': MARKDOWN_KEYWORDS,
  '.markdown': MARKDOWN_KEYWORDS,
};

// Common editors (next priority)
const EDITOR_KEYWORDS = [
  'textedit', 'visual studio code', 'vscode', 'code',
  'cursor', 'codex', 'sublime', 'trae', 'windsurf',
  'jetbrains', 'webstorm', 'intellij', 'pycharm', 'goland',
  'vim', 'emacs', 'atom', 'nova',
];

function curateApps(apps: AppInfo[], ext: string): AppInfo[] {
  if (HTML_EXTENSIONS.has(ext)) {
    return curateBrowserApps(apps);
  }

  const officeKeywords = EXT_OFFICE_KEYWORDS[ext] ?? [];

  const filtered = apps.filter(a => {
    if (a.bundleId && EXCLUDED_BUNDLE_IDS.has(a.bundleId)) return false;
    if (EXCLUDED_NAME_PATTERNS.some(re => re.test(a.name))) return false;
    // Drop helper apps nested inside another .app bundle.
    const appComponents = a.path.split('.app/');
    if (appComponents.length > 2) return false;
    // Drop browser snapshot/install paths in user library.
    if (/chromium|chrome.*snapshots|puppeteer/i.test(a.path)) return false;
    return true;
  });

  const tierOf = (a: AppInfo): number => {
    if (a.isDefault) return 0;
    const lower = a.name.toLowerCase();
    if (officeKeywords.some(kw => lower.includes(kw))) return 1;
    if (EDITOR_KEYWORDS.some(kw => lower.includes(kw))) return 2;
    return 3;
  };

  filtered.sort((a, b) => {
    const ta = tierOf(a), tb = tierOf(b);
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });

  return filtered.slice(0, MAX_APPS_IN_LIST);
}

function curateBrowserApps(apps: AppInfo[]): AppInfo[] {
  const filtered = apps.filter(a => {
    if (a.bundleId && BROWSER_BUNDLE_IDS.has(a.bundleId)) return true;
    if (BROWSER_NAME_PATTERNS.some(re => re.test(a.name))) return true;
    return BROWSER_NAME_PATTERNS.some(re => re.test(a.path));
  });

  filtered.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return filtered.slice(0, MAX_APPS_IN_LIST);
}

export async function openFileWithApp(filePath: string, appPath: string): Promise<void> {
  switch (process.platform) {
    case 'darwin':
      await execFileAsync('open', ['-a', appPath, filePath], 5000);
      break;
    case 'win32':
      spawn(appPath, [filePath], { detached: true, stdio: 'ignore' }).unref();
      break;
    case 'linux':
      if (appPath.endsWith('.desktop')) {
        await execFileAsync('gtk-launch', [appPath, filePath], 5000).catch(() =>
          execFileAsync('gio', ['launch', appPath, filePath], 5000)
        );
      } else {
        spawn(appPath, [filePath], { detached: true, stdio: 'ignore' }).unref();
      }
      break;
    default:
      await shell.openPath(filePath);
  }
}

// ── macOS: JXA via osascript ─────────────────────────────────────

async function getApps_macOS(filePath: string): Promise<AppInfo[]> {
  const script = `
ObjC.import("AppKit");
ObjC.import("Foundation");
var url = $.NSURL.fileURLWithPath(${JSON.stringify(filePath)});
var ws = $.NSWorkspace.sharedWorkspace;
var apps = ws.URLsForApplicationsToOpenURL(url);
var defaultApp = ws.URLForApplicationToOpenURL(url);
var defaultPath = defaultApp ? ObjC.unwrap(defaultApp.path) : "";
var result = [];
for (var i = 0; i < apps.count; i++) {
  var appURL = apps.objectAtIndex(i);
  var bundle = $.NSBundle.bundleWithURL(appURL);
  var name = "", bundleId = "", iconPath = "";
  if (bundle) {
    var info = bundle.infoDictionary;
    var dn = info.objectForKey("CFBundleDisplayName");
    var bn = info.objectForKey("CFBundleName");
    name = dn ? ObjC.unwrap(dn) : (bn ? ObjC.unwrap(bn) : "");
    var bi = bundle.bundleIdentifier;
    bundleId = bi ? ObjC.unwrap(bi) : "";
    var iconFile = info.objectForKey("CFBundleIconFile") || info.objectForKey("CFBundleIconName");
    var resPath = ObjC.unwrap(appURL.path) + "/Contents/Resources/";
    var candidates = [];
    if (iconFile) {
      var ic = ObjC.unwrap(iconFile);
      candidates.push(ic);
      if (!ic.endsWith(".icns")) candidates.push(ic + ".icns");
    }
    candidates.push("AppIcon.icns");
    for (var k = 0; k < candidates.length; k++) {
      var candidate = resPath + candidates[k];
      if ($.NSFileManager.defaultManager.fileExistsAtPath(candidate)) {
        iconPath = candidate;
        break;
      }
    }
  }
  var p = ObjC.unwrap(appURL.path);
  if (!name) {
    var basename = p.split("/").pop() || p;
    name = basename.replace(/\\.app$/, "");
  }
  result.push({ name: name, bundleId: bundleId, path: p, isDefault: p === defaultPath, iconPath: iconPath });
}
result.sort(function(a, b) {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return a.name.localeCompare(b.name);
});
JSON.stringify(result);`;

  const output = await execFileAsync('osascript', ['-l', 'JavaScript', '-e', script], 5000);
  return JSON.parse(output.trim());
}

// ── Windows: PowerShell registry query ───────────────────────────

async function getApps_windows(ext: string): Promise<AppInfo[]> {
  if (!ext.startsWith('.')) ext = '.' + ext;

  const psScript = `
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$ext = "${ext}"
$apps = @{}

$key = "Registry::HKEY_CLASSES_ROOT\\$ext\\OpenWithProgids"
if (Test-Path $key) {
  (Get-Item $key).GetValueNames() | Where-Object { $_ -ne "" -and $_ -ne "(default)" } | ForEach-Object {
    $apps[$_] = @{ source = "progid" }
  }
}

$key = "Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\OpenWithProgids"
if (Test-Path $key) {
  (Get-Item $key).GetValueNames() | Where-Object { $_ -ne "" -and $_ -ne "(default)" } | ForEach-Object {
    $apps[$_] = @{ source = "progid" }
  }
}

$key = "Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\OpenWithList"
if (Test-Path $key) {
  $item = Get-Item $key
  $mru = $item.GetValue("MRUList")
  if ($mru) {
    foreach ($c in $mru.ToCharArray()) {
      $exeName = $item.GetValue([string]$c)
      if ($exeName) { $apps["APP:$exeName"] = @{ source = "exe"; exeName = $exeName } }
    }
  }
}

$regApps = Get-ItemProperty "Registry::HKEY_LOCAL_MACHINE\\SOFTWARE\\RegisteredApplications" -ErrorAction SilentlyContinue
if ($regApps) {
  foreach ($prop in $regApps.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }) {
    $capPath = "Registry::HKEY_LOCAL_MACHINE\\$($prop.Value)\\FileAssociations"
    if (Test-Path $capPath) {
      $progId = (Get-ItemProperty $capPath -ErrorAction SilentlyContinue).$ext
      if ($progId) { $apps[$progId] = @{ source = "registered"; appName = $prop.Name } }
    }
  }
}

$defaultProgId = ""
$ucKey = "Registry::HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\$ext\\UserChoice"
if (Test-Path $ucKey) {
  $defaultProgId = (Get-ItemProperty $ucKey -ErrorAction SilentlyContinue).ProgId
}

$result = @()
foreach ($entry in $apps.Keys) {
  $progId = $entry
  $exePath = ""
  $displayName = ""

  if ($entry.StartsWith("APP:")) {
    $exeName = $entry.Substring(4)
    $cmdKey = "Registry::HKEY_CLASSES_ROOT\\Applications\\$exeName\\shell\\open\\command"
    if (Test-Path $cmdKey) {
      $cmd = (Get-ItemProperty $cmdKey).'(default)'
      if ($cmd -match '"([^"]+)"') { $exePath = $Matches[1] }
      elseif ($cmd -match '^([^ ]+)') { $exePath = $Matches[1] }
    }
    $progId = $exeName
  } else {
    $cmdKey = "Registry::HKEY_CLASSES_ROOT\\$progId\\shell\\open\\command"
    if (Test-Path $cmdKey) {
      $cmd = (Get-ItemProperty $cmdKey).'(default)'
      if ($cmd -match '"([^"]+)"') { $exePath = $Matches[1] }
      elseif ($cmd -match '^([^ ]+)') { $exePath = $Matches[1] }
    }
    $displayName = (Get-ItemProperty "Registry::HKEY_CLASSES_ROOT\\$progId" -ErrorAction SilentlyContinue).'(default)'
  }

  if ($exePath -and (Test-Path $exePath)) {
    $vi = (Get-Item $exePath).VersionInfo
    if (-not $displayName) { $displayName = $vi.FileDescription }
    if (-not $displayName) { $displayName = $vi.ProductName }
  }
  if (-not $displayName) {
    $displayName = [System.IO.Path]::GetFileNameWithoutExtension($exePath)
  }

  if ($exePath -and (Test-Path $exePath)) {
    $result += @{ name = $displayName; path = $exePath; isDefault = ($progId -eq $defaultProgId -or $entry -eq $defaultProgId) }
  }
}
$result | ConvertTo-Json -Compress`;

  const output = await execFileAsync('powershell', ['-NoProfile', '-Command', psScript], 10000);
  const parsed = JSON.parse(output.trim() || '[]');
  const list: AppInfo[] = (Array.isArray(parsed) ? parsed : [parsed]).map((a: { name: string; path: string; isDefault: boolean }) => ({
    name: a.name || path.basename(a.path, '.exe'),
    path: a.path,
    isDefault: !!a.isDefault,
  }));
  list.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return list;
}

// ── Linux: mimeinfo.cache + .desktop files ───────────────────────

async function getApps_linux(filePath: string): Promise<AppInfo[]> {
  let mimeType = '';
  try {
    mimeType = (await execFileAsync('file', ['--mime-type', '-b', filePath], 3000)).trim();
  } catch {
    return [];
  }
  if (!mimeType) return [];

  const desktopFileNames = new Set<string>();
  const cachePaths = [
    '/usr/share/applications/mimeinfo.cache',
    '/usr/local/share/applications/mimeinfo.cache',
    path.join(os.homedir(), '.local/share/applications/mimeinfo.cache'),
  ];
  for (const cachePath of cachePaths) {
    try {
      const content = fs.readFileSync(cachePath, 'utf-8');
      for (const line of content.split('\n')) {
        if (line.startsWith(mimeType + '=')) {
          for (const name of line.substring(mimeType.length + 1).split(';')) {
            if (name.trim()) desktopFileNames.add(name.trim());
          }
        }
      }
    } catch { /* file may not exist */ }
  }

  let defaultDesktopFile = '';
  try {
    defaultDesktopFile = (await execFileAsync('xdg-mime', ['query', 'default', mimeType], 3000)).trim();
  } catch { /* xdg-mime may not be available */ }

  const desktopDirs = [
    '/usr/share/applications',
    '/usr/local/share/applications',
    path.join(os.homedir(), '.local/share/applications'),
    '/var/lib/flatpak/exports/share/applications',
    path.join(os.homedir(), '.local/share/flatpak/exports/share/applications'),
  ];

  const results: AppInfo[] = [];
  for (const df of desktopFileNames) {
    for (const dir of desktopDirs) {
      const fullPath = path.join(dir, df);
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const entry = parseDesktopEntry(content);
        results.push({
          name: entry.Name || df.replace('.desktop', ''),
          path: df,
          isDefault: df === defaultDesktopFile,
        });
        break;
      } catch { /* not in this dir */ }
    }
  }

  results.sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return results;
}

function parseDesktopEntry(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let inEntry = false;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '[Desktop Entry]') { inEntry = true; continue; }
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) { inEntry = false; continue; }
    if (!inEntry) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.substring(0, eq).trim();
      if (!key.includes('[')) {
        result[key] = trimmed.substring(eq + 1).trim();
      }
    }
  }
  return result;
}

// ── Icon Extraction ──────────────────────────────────────────────

async function fetchIcons(apps: AppInfo[]): Promise<void> {
  const tasks = apps.map(async (appInfo) => {
    try {
      const icon = await extractIcon(appInfo);
      if (icon) appInfo.icon = icon;
    } catch {
      // leave icon undefined
    }
  });
  await Promise.all(tasks);
}

async function extractIcon(appInfo: AppInfo): Promise<string | null> {
  // macOS: use sips to convert .icns → PNG → data URL
  if (process.platform === 'darwin' && appInfo.iconPath && fs.existsSync(appInfo.iconPath)) {
    const png = await icnsToPng(appInfo.iconPath);
    if (png) return png;
  }
  // Fallback (mainly Windows): use Electron's app.getFileIcon
  try {
    if (!app.isReady()) return null;
    const img = await app.getFileIcon(appInfo.path, { size: 'normal' });
    if (!img.isEmpty()) return img.toDataURL();
  } catch {
    // ignore
  }
  return null;
}

async function icnsToPng(icnsPath: string): Promise<string | null> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'yuzhh-ai-app-icon-'));
  const pngPath = path.join(tmpDir, 'icon.png');
  try {
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', icnsPath, '--out', pngPath], 5000);
    const buf = await fs.promises.readFile(pngPath);
    if (buf.byteLength === 0) return null;
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    return null;
  } finally {
    fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ });
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function execFileAsync(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf-8', timeout }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

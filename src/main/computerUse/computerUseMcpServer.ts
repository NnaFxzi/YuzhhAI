import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import type { ResolvedMcpServer } from '../libs/openclawConfigSync';
import { findSystemNodePath } from '../libs/resolveStdioCommand';

export const ComputerUseMcpServerName = {
  BuiltIn: 'computer-use',
} as const;
export type ComputerUseMcpServerName =
  typeof ComputerUseMcpServerName[keyof typeof ComputerUseMcpServerName];

export const ComputerUseMcpEnv = {
  AskUserUrl: 'LOBSTER_COMPUTER_USE_ASKUSER_URL',
  BridgeSecret: 'LOBSTER_MCP_BRIDGE_SECRET',
  ExePath: 'LOBSTER_COMPUTER_USE_EXE',
  SdkRoot: 'LOBSTER_COMPUTER_USE_MCP_SDK_ROOT',
  SkyRoot: 'LOBSTER_COMPUTER_USE_SKY_ROOT',
  ZodRoot: 'LOBSTER_COMPUTER_USE_ZOD_ROOT',
} as const;
export type ComputerUseMcpEnv =
  typeof ComputerUseMcpEnv[keyof typeof ComputerUseMcpEnv];

type ResolveComputerUseMcpServerOptions = {
  askUserCallbackUrl: string | null;
  bridgeSecret: string;
  electronNodePath: string;
};

type ComputerUseRuntimePaths = {
  helperExePath: string;
  skyRoot: string;
};

const SERVER_SCRIPT_NAME = 'computer-use-mcp-server.mjs';

function isDirectory(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolvePackageRoot(packageName: string): string | null {
  try {
    let currentDir = path.dirname(require.resolve(`${packageName}/package.json`));
    while (currentDir && currentDir !== path.dirname(currentDir)) {
      const packageJsonPath = path.join(currentDir, 'package.json');
      if (isFile(packageJsonPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
            name?: string;
          };
          if (manifest.name === packageName) {
            return currentDir;
          }
        } catch {
          // Keep walking upward; package export shims can point at tiny
          // package.json files that are not the package root.
        }
      }
      currentDir = path.dirname(currentDir);
    }
    return null;
  } catch {
    return null;
  }
}

function listComputerUsePluginRoots(): string[] {
  const overrideSkyRoot = process.env[ComputerUseMcpEnv.SkyRoot]?.trim();
  const overrideExePath = process.env[ComputerUseMcpEnv.ExePath]?.trim();
  if (overrideSkyRoot || overrideExePath) {
    const root = overrideSkyRoot
      ? path.resolve(overrideSkyRoot, '..', '..')
      : path.resolve(overrideExePath!, '..', '..', '..');
    return [root];
  }

  const baseDir = path.join(
    app.getPath('home'),
    '.codex',
    'plugins',
    'cache',
    'openai-bundled',
    'computer-use',
  );
  if (!isDirectory(baseDir)) {
    return [];
  }

  return fs.readdirSync(baseDir)
    .map((entry) => path.join(baseDir, entry))
    .filter(isDirectory)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
}

export function resolveComputerUseRuntimePaths(): ComputerUseRuntimePaths | null {
  if (process.platform !== 'win32') {
    return null;
  }

  const overrideSkyRoot = process.env[ComputerUseMcpEnv.SkyRoot]?.trim();
  const overrideExePath = process.env[ComputerUseMcpEnv.ExePath]?.trim();
  if (overrideSkyRoot && overrideExePath) {
    if (isDirectory(overrideSkyRoot) && isFile(overrideExePath)) {
      return { helperExePath: overrideExePath, skyRoot: overrideSkyRoot };
    }
    return null;
  }

  for (const pluginRoot of listComputerUsePluginRoots()) {
    const skyRoot = overrideSkyRoot || path.join(pluginRoot, 'node_modules', '@oai', 'sky');
    const helperExePath = overrideExePath || path.join(skyRoot, 'bin', 'windows', 'codex-computer-use.exe');
    if (isDirectory(skyRoot) && isFile(helperExePath)) {
      return { helperExePath, skyRoot };
    }
  }

  return null;
}

export function ensureComputerUseMcpServerScript(): string {
  const scriptDir = path.join(app.getPath('userData'), 'mcp-bridge', 'bin');
  fs.mkdirSync(scriptDir, { recursive: true });
  const scriptPath = path.join(scriptDir, SERVER_SCRIPT_NAME);
  const existing = isFile(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
  if (existing !== COMPUTER_USE_MCP_SERVER_SCRIPT) {
    fs.writeFileSync(scriptPath, COMPUTER_USE_MCP_SERVER_SCRIPT, 'utf8');
  }
  return scriptPath;
}

export function resolveComputerUseMcpServer(
  options: ResolveComputerUseMcpServerOptions,
): ResolvedMcpServer | null {
  if (process.platform !== 'win32') {
    return null;
  }
  if (!options.askUserCallbackUrl) {
    console.warn('[ComputerUseMCP] skipped built-in server because AskUser callback is unavailable');
    return null;
  }

  const runtimePaths = resolveComputerUseRuntimePaths();
  if (!runtimePaths) {
    console.warn('[ComputerUseMCP] skipped built-in server because codex-computer-use.exe was not found');
    return null;
  }

  const sdkRoot = resolvePackageRoot('@modelcontextprotocol/sdk');
  const zodRoot = resolvePackageRoot('zod');
  if (!sdkRoot || !zodRoot) {
    console.warn('[ComputerUseMCP] skipped built-in server because MCP SDK or zod was not found');
    return null;
  }

  const systemNodePath = app.isPackaged ? null : findSystemNodePath();
  const command = systemNodePath || options.electronNodePath;
  const env: Record<string, string> = {
    [ComputerUseMcpEnv.AskUserUrl]: options.askUserCallbackUrl,
    [ComputerUseMcpEnv.BridgeSecret]: options.bridgeSecret,
    [ComputerUseMcpEnv.ExePath]: runtimePaths.helperExePath,
    [ComputerUseMcpEnv.SdkRoot]: sdkRoot,
    [ComputerUseMcpEnv.SkyRoot]: runtimePaths.skyRoot,
    [ComputerUseMcpEnv.ZodRoot]: zodRoot,
  };
  if (!systemNodePath) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }

  return {
    name: ComputerUseMcpServerName.BuiltIn,
    transportType: 'stdio',
    command,
    args: [ensureComputerUseMcpServerScript()],
    env,
  };
}

const COMPUTER_USE_MCP_SERVER_SCRIPT = String.raw`import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const env = process.env;

function requireEnv(name) {
  const value = env[name]?.trim();
  if (!value) {
    throw new Error(name + ' is required');
  }
  return value;
}

function moduleUrl(...parts) {
  return pathToFileURL(path.join(...parts)).href;
}

const sdkRoot = requireEnv('LOBSTER_COMPUTER_USE_MCP_SDK_ROOT');
const zodRoot = requireEnv('LOBSTER_COMPUTER_USE_ZOD_ROOT');
const skyRoot = requireEnv('LOBSTER_COMPUTER_USE_SKY_ROOT');
const helperExePath = requireEnv('LOBSTER_COMPUTER_USE_EXE');
const askUserUrl = requireEnv('LOBSTER_COMPUTER_USE_ASKUSER_URL');
const bridgeSecret = requireEnv('LOBSTER_MCP_BRIDGE_SECRET');

const { McpServer } = await import(moduleUrl(sdkRoot, 'dist', 'esm', 'server', 'mcp.js'));
const { StdioServerTransport } = await import(moduleUrl(sdkRoot, 'dist', 'esm', 'server', 'stdio.js'));
const { z } = await import(moduleUrl(zodRoot, 'index.js'));
const { WindowsComputerUseClient } = await import(
  moduleUrl(skyRoot, 'dist', 'project', 'cua', 'sky_js', 'src', 'targets', 'windows', 'internal', 'computer_use_client.js')
);

const APPROVED_APP_META_KEY = 'x-oai-cua-approved-app';
const MAX_TEXT_CHARS = 30000;
const deniedAppPattern = [
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'windowsterminal.exe',
  'wt.exe',
  'openssh',
  'terminal',
  '1password',
  'keepass',
  'bitwarden',
  'lastpass',
  'credential',
  'securityhealth',
  'windowsdefender',
  'taskmgr.exe',
].join('|');
const deniedAppRe = new RegExp(deniedAppPattern, 'i');
const approvedApps = new Set();
const requestMeta = {
  session_id: 'lobsterai-computer-use',
  turn_id: String(Date.now()),
};

function truncateText(value, maxChars = MAX_TEXT_CHARS) {
  if (typeof value !== 'string') {
    return value;
  }
  if (value.length <= maxChars) {
    return value;
  }
  return value.slice(0, maxChars) + '\n\n[truncated ' + (value.length - maxChars) + ' chars]';
}

function normalizeAppLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'Unknown app';
}

function isDeniedApp(app, displayName) {
  return deniedAppRe.test(String(app || '')) || deniedAppRe.test(String(displayName || ''));
}

async function askUserApproval(request) {
  const meta = request?.meta && typeof request.meta === 'object' ? request.meta : {};
  const toolParams = meta.tool_params && typeof meta.tool_params === 'object' ? meta.tool_params : {};
  const app = normalizeAppLabel(toolParams.app);
  const displayName = normalizeAppLabel(
    meta.tool_params_display?.[0]?.value || toolParams.app || request?.message,
  );

  if (isDeniedApp(app, displayName)) {
    throw new Error('Computer Use is not allowed to control this app: ' + displayName);
  }

  if (approvedApps.has(app)) {
    requestMeta[APPROVED_APP_META_KEY] = app;
    return { action: 'accept' };
  }

  const response = await fetch(askUserUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-mcp-bridge-secret': bridgeSecret,
    },
    body: JSON.stringify({
      questions: [{
        title: 'Computer Use',
        subtitle: 'Computer Use wants to control a Windows application.',
        question: 'Allow Computer Use to use "' + displayName + '"?',
        options: [
          { label: 'Allow', description: app },
          { label: 'Deny', description: 'Do not allow this app.' },
        ],
      }],
    }),
  });

  if (!response.ok) {
    throw new Error('Computer Use approval failed with HTTP ' + response.status);
  }

  const body = await response.json();
  const answer = Object.values(body.answers || {})[0];
  if (body.behavior === 'allow' && String(answer || '').toLowerCase() !== 'deny') {
    approvedApps.add(app);
    requestMeta[APPROVED_APP_META_KEY] = app;
    return { action: 'accept' };
  }
  throw new Error('Computer Use was not approved to use ' + displayName);
}

globalThis.nodeRepl = {
  requestMeta,
  createElicitation: askUserApproval,
  emitImage: async () => {},
};

const client = new WindowsComputerUseClient({
  helperPath: helperExePath,
  timeoutMs: 30000,
});

const server = new McpServer({
  name: 'computer-use',
  version: '0.1.0',
});

const WindowSchema = z.object({
  app: z.string().min(1),
  id: z.number().int().nonnegative(),
  title: z.string().optional(),
});

function textContent(text) {
  return [{ type: 'text', text }];
}

function jsonText(value) {
  return JSON.stringify(value, null, 2);
}

function successText(value) {
  return { content: textContent(typeof value === 'string' ? value : jsonText(value)) };
}

function screenshotContent(screenshot) {
  const url = String(screenshot.url || '');
  const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  return {
    type: 'image',
    mimeType: match[1],
    data: match[2],
  };
}

function windowSummary(window) {
  return {
    app: window?.app,
    id: window?.id,
    title: window?.title,
  };
}

function stateToContent(state) {
  const screenshots = Array.isArray(state.screenshots) ? state.screenshots : [];
  const summary = {
    window: windowSummary(state.window),
    screenshots: screenshots.map((screenshot) => ({
      id: screenshot.id,
      zIndex: screenshot.zIndex,
      originX: screenshot.originX,
      originY: screenshot.originY,
      width: screenshot.width,
      height: screenshot.height,
    })),
    accessibility: state.accessibility
      ? {
          focused_element: state.accessibility.focused_element,
          selected_text: state.accessibility.selected_text,
          selected_elements: state.accessibility.selected_elements,
          document_text: truncateText(state.accessibility.document_text),
          tree: truncateText(state.accessibility.tree),
        }
      : null,
  };
  return [
    { type: 'text', text: jsonText(summary) },
    ...screenshots.map(screenshotContent).filter(Boolean),
  ];
}

function registerTool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema }, async (args) => {
    try {
      return await handler(args || {});
    } catch (error) {
      return {
        content: textContent(error instanceof Error ? error.message : String(error)),
        isError: true,
      };
    }
  });
}

registerTool('list_windows', 'List open Windows app windows targetable by Computer Use.', {}, async () => {
  return successText(await client.list_windows());
});

registerTool('list_apps', 'List installed and recently used Windows apps, including open windows.', {}, async () => {
  return successText(await client.list_apps());
});

registerTool('launch_app', 'Launch a Windows app by id returned from list_apps or by explicit .exe path.', {
  app: z.string().min(1),
}, async (args) => {
  await client.launch_app(args);
  return successText('App launch requested.');
});

registerTool('get_window', 'Refresh a window handle returned by list_windows or list_apps.', {
  window: WindowSchema,
}, async ({ window }) => {
  return successText(await client.get_window(window));
});

registerTool('get_window_state', 'Capture a target window screenshot and/or accessibility tree.', {
  window: WindowSchema,
  include_screenshot: z.boolean().optional().default(true),
  include_text: z.boolean().optional().default(false),
}, async ({ window, include_screenshot = true, include_text = false }) => {
  const state = await client.get_window_state({
    window,
    include_screenshot,
    include_text,
  });
  return { content: stateToContent(state) };
});

registerTool('activate_window', 'Bring a target window to the foreground.', {
  window: WindowSchema,
}, async ({ window }) => {
  await client.activate_window({ window });
  return successText('Window activated.');
});

registerTool('click', 'Click a coordinate or accessibility element in a target window.', {
  window: WindowSchema,
  x: z.number().optional(),
  y: z.number().optional(),
  screenshotId: z.string().optional(),
  element_index: z.number().int().nonnegative().optional(),
  mouse_button: z.enum(['left', 'right', 'middle', 'l', 'r', 'm']).optional(),
  click_count: z.number().int().positive().optional(),
}, async (args) => {
  await client.click(args);
  return successText('Click completed.');
});

registerTool('press_key', 'Press a key or key chord in a target window.', {
  window: WindowSchema,
  key: z.string().min(1),
}, async (args) => {
  await client.press_key(args);
  return successText('Key press completed.');
});

registerTool('type_text', 'Type literal text into the focused control in a target window.', {
  window: WindowSchema,
  text: z.string(),
}, async (args) => {
  await client.type_text(args);
  return successText('Text entry completed.');
});

registerTool('scroll', 'Scroll from a coordinate in a target window screenshot.', {
  window: WindowSchema,
  x: z.number(),
  y: z.number(),
  scrollX: z.number(),
  scrollY: z.number(),
  screenshotId: z.string().optional(),
}, async (args) => {
  await client.scroll(args);
  return successText('Scroll completed.');
});

registerTool('drag', 'Drag from one coordinate to another inside a target window.', {
  window: WindowSchema,
  from_x: z.number(),
  from_y: z.number(),
  to_x: z.number(),
  to_y: z.number(),
  screenshotId: z.string().optional(),
}, async (args) => {
  await client.drag(args);
  return successText('Drag completed.');
});

registerTool('set_value', 'Set the value of an editable accessibility element in a target window.', {
  window: WindowSchema,
  element_index: z.number().int().nonnegative(),
  value: z.string(),
}, async (args) => {
  await client.set_value(args);
  return successText('Value set completed.');
});

registerTool('perform_secondary_action', 'Invoke a secondary accessibility action on an indexed element.', {
  window: WindowSchema,
  element_index: z.number().int().nonnegative(),
  action: z.string().min(1),
}, async (args) => {
  await client.perform_secondary_action(args);
  return successText('Secondary action completed.');
});

process.once('SIGINT', () => {
  void client.close().finally(() => process.exit(0));
});
process.once('SIGTERM', () => {
  void client.close().finally(() => process.exit(0));
});

await server.connect(new StdioServerTransport());
`;

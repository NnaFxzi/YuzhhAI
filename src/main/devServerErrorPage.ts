const escapeHtml = (value: string): string => (
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
);

export function buildDevServerUnavailableHtml(devServerUrl: string): string {
  const escapedUrl = escapeHtml(devServerUrl);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>开发服务未启动</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0b0e13;
      color: #e5e7eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(520px, calc(100vw - 48px));
      border: 1px solid rgba(148, 163, 184, 0.22);
      border-radius: 14px;
      background: rgba(17, 24, 39, 0.82);
      padding: 28px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
    }
    h1 {
      margin: 0;
      font-size: 20px;
      line-height: 1.4;
    }
    p {
      margin: 12px 0 0;
      color: #a6adbb;
      font-size: 14px;
      line-height: 1.7;
    }
    code {
      display: block;
      margin-top: 16px;
      padding: 12px;
      border-radius: 10px;
      background: rgba(2, 6, 23, 0.7);
      color: #93c5fd;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <main>
    <h1>开发服务未启动</h1>
    <p>Electron 已打开，但没有连接到前端开发服务。请使用 npm run electron:dev 启动完整开发环境，或先确认 Vite 服务正在监听下面的地址。</p>
    <code>${escapedUrl}</code>
  </main>
</body>
</html>`;
}

export function buildDevServerUnavailableDataUrl(devServerUrl: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(buildDevServerUnavailableHtml(devServerUrl))}`;
}

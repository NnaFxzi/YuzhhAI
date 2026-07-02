# Publish Branding Design

## Goal

Rebrand the desktop app for publishable builds as "宇智汇和 AI 助手" by replacing the application identity, package identity, local storage identity, deep-link scheme, visible legal links, and user-facing documentation while keeping backend service identifiers that are still required for compatibility.

## Scope

Use the following publish identifiers:

- Product name: `宇智汇和 AI 助手`
- Company name: `宇智汇和（东莞）科技有限公司`
- npm package name: `yuzhh-ai-assistant`
- Electron appId: `com.yuzhh.aiassistant`
- Deep-link scheme: `yuzhhai`
- Runtime app id: `yuzhh-ai-assistant`
- Database file: `yuzhh-ai-assistant.sqlite`
- Default project directory: `~/yuzhh-ai-assistant/project`
- Task workspace folder: `.yuzhh-ai-tasks`
- Log archive prefix: `yuzhh-ai-logs`
- Provider export type: `yuzhh-ai-assistant.providers`
- Provider export password marker: `yuzhh-ai-assistant-APP`

## Architecture

Branding will be centralized through existing app constants where possible. Packaging metadata remains in `electron-builder.json`, `scripts/electron-builder-config.cjs`, `package.json`, and `package-lock.json`. User-visible copy and links remain in renderer i18n and settings components.

## Compatibility Boundaries

Do not rename these during this publish-branding pass:

- `OpenClaw` and bundled runtime folder `cfmind`
- Provider keys and tool names such as `lobsterai-server`, `lobsterai_image_generate`, and `lobsterai_video_generate`
- Server integration docs under `docs/server-integration`
- IM platform names such as NetEase IM, NetEase Bee, and Youdao provider names when they describe third-party integrations
- Existing OpenClaw patch comments and test fixtures that are not user-facing

This is a clean publish identity, not a migration from old LobsterAI user data. Existing local app data under the old app identity will not be automatically imported.

## Verification

- Search source and packaging files for old publish identity strings.
- Run focused brand tests.
- Run ESLint on touched TypeScript and TSX files.
- Run `npm run build`.
- Run `npm run compile:electron` with normal host permissions if sandboxed native rebuild access is denied.

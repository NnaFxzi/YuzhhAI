# Publish Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the app's publish identity from LobsterAI to 宇智汇和 AI 助手 using the approved scheme B identifiers.

**Architecture:** Update packaging metadata, centralized runtime constants, deep-link registration, local path names, user-visible legal links, and public documentation. Keep backend provider keys and OpenClaw runtime names unchanged to preserve functionality.

**Tech Stack:** Electron, React, TypeScript, electron-builder, Vite, Vitest, ESLint.

---

### Task 1: Packaging Identity

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron-builder.json`
- Modify: `scripts/electron-builder-config.cjs`

- [ ] Change npm package name to `yuzhh-ai-assistant`.
- [ ] Change author to `宇智汇和（东莞）科技有限公司`.
- [ ] Change author email to `contact@yuzhh.com`.
- [ ] Change Electron `appId` to `com.yuzhh.aiassistant`.
- [ ] Change deep-link scheme from `lobsterai` to `yuzhhai`.
- [ ] Ensure artifact names and generated builder config use `宇智汇和 AI 助手`.
- [ ] Search these files for `lobsterai`, `LobsterAI`, and `com.lobsterai`.

### Task 2: Runtime Constants And Local Paths

**Files:**
- Modify: `src/main/appConstants.ts`
- Modify: `src/renderer/constants/app.ts`
- Modify: `src/main/main.ts`
- Modify: `src/main/coworkStore.ts`
- Modify: `src/main/shellApps.ts`
- Modify: `src/main/libs/githubCopilotAuth.ts`
- Modify tests that assert the changed local path or constant values.

- [ ] Set app constants to the approved identifiers.
- [ ] Replace the app temp attachment folder with `yuzhh-ai-assistant/attachments`.
- [ ] Replace log export prefix with `yuzhh-ai-logs`.
- [ ] Replace default project directory with `~/yuzhh-ai-assistant/project`.
- [ ] Replace task workspace folder with `.yuzhh-ai-tasks`.
- [ ] Replace deep-link registration and parsing from `lobsterai://` to `yuzhhai://`.
- [ ] Replace non-backend User-Agent branding with `宇智汇和 AI 助手`.
- [ ] Keep `lobsterai-server` provider keys and media tool names unchanged.

### Task 3: User-Visible Legal Links And Public Pages

**Files:**
- Modify: `index.html`
- Modify: `resources/error.html`
- Modify: `src/renderer/components/Settings.tsx`
- Modify: `src/renderer/components/PrivacyDialog.tsx`
- Modify: `src/renderer/services/i18n.ts`
- Modify: `src/renderer/services/i18n.brand.test.ts`

- [ ] Replace HTML titles with `宇智汇和 AI 助手`.
- [ ] Replace contact email with `contact@yuzhh.com`.
- [ ] Replace user manual, community, and service terms URLs with neutral `https://www.yuzhh.com/...` URLs.
- [ ] Replace privacy dialog URL with `https://www.yuzhh.com/legal/ai-assistant-service`.
- [ ] Update brand tests to assert the new package identifiers and legal links.
- [ ] Do not change server pricing, portal, or auth URLs in this pass unless the UI link is a static About/legal entry.

### Task 4: README Branding

**Files:**
- Modify: `README.md`
- Modify: `README_zh.md`

- [ ] Replace README title and alt text with `宇智汇和 AI 助手`.
- [ ] Replace old GitHub badge/download links with neutral placeholders or remove old repository-specific badge links.
- [ ] Replace `LobsterAI` product mentions with `宇智汇和 AI 助手`.
- [ ] Replace database filename references with `yuzhh-ai-assistant.sqlite`.
- [ ] Keep third-party integration names where they describe real integrations.

### Task 5: Verification

**Commands:**
- `rg -n "LobsterAI|com\\.lobsterai|lobsterai://|lobsterai.sqlite|lobsterai-logs|\\.lobsterai-tasks" package.json package-lock.json electron-builder.json src index.html resources README.md README_zh.md`
- `npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 <touched-ts-files>`
- `npm test -- src/renderer/services/i18n.brand.test.ts`
- `npm run build`
- `npm run compile:electron`

- [ ] Confirm remaining `lobsterai-server`, `lobsterai_image_generate`, `lobsterai_video_generate`, and `cfmind` matches are intentional technical identifiers.
- [ ] Report any verification warning that is unrelated legacy output.

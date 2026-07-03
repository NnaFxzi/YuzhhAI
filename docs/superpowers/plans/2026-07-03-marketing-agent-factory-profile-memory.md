# Marketing Agent Factory Profile Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine `推广agent` so its default behavior is a single-factory, memory-backed promotion assistant that extracts stable factory facts, reuses them, and distinguishes temporary campaign details from long-term profile changes.

**Architecture:** This first implementation is prompt-level and preset-level only. `src/main/presetAgents.ts` owns the agent identity and prompt, while `src/main/agentManager.ts` auto-installs and refreshes the managed preset so existing users receive the updated prompt without changing runtime fields such as model, cwd, pinning, or enabled state.

**Tech Stack:** TypeScript, Vitest, existing Agent preset and CoworkStore abstractions.

---

### Task 1: Pin Single-Factory Memory Behavior In Tests

**Files:**
- Modify: `src/main/agentManager.test.ts`

- [ ] **Step 1: Add failing assertions**

Add assertions to the existing prompt test requiring these phrases:

```ts
expect(marketingAgent?.systemPrompt).toContain('默认只维护一家工厂画像');
expect(marketingAgent?.systemPrompt).toContain('本次任务临时要求');
expect(marketingAgent?.systemPrompt).toContain('长期资料更新信号');
expect(marketingAgent?.systemPrompt).toContain('原来记住的资料先保留');
expect(marketingAgent?.systemPrompt).toContain('生成前用一句话确认');
```

- [ ] **Step 2: Run test to verify red**

Run: `npm test -- src/main/agentManager.test.ts`

Expected: fails because the current prompt does not contain all required single-factory memory rules.

### Task 2: Update Marketing Agent Prompt

**Files:**
- Modify: `src/main/presetAgents.ts`

- [ ] **Step 1: Refine Chinese prompt**

Update the `推广agent` `systemPrompt` memory sections to explicitly cover:

```text
默认只维护一家工厂画像
本次任务临时要求
长期资料更新信号
原来记住的资料先保留
生成前用一句话确认
```

- [ ] **Step 2: Refine English prompt**

Mirror the behavior in `systemPromptEn`, including one-factory profile, temporary task details, long-term update signals, conflict handling, and one-sentence context confirmation.

- [ ] **Step 3: Run test to verify green**

Run: `npm test -- src/main/agentManager.test.ts`

Expected: all AgentManager tests pass.

### Task 3: Verify Integration

**Files:**
- Verify touched files only.

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/main/agentManager.test.ts`

Expected: pass.

- [ ] **Step 2: Run touched-file lint**

Run:

```bash
npx eslint --ext ts,tsx --report-unused-disable-directives --max-warnings 0 src/main/agentManager.ts src/main/agentManager.test.ts src/main/presetAgents.ts
```

Expected: pass with no warnings.

- [ ] **Step 3: Run compile/build as needed**

Run: `npm run compile:electron`

Expected: Electron TypeScript compile passes.

Run: `npm run build`

Expected: renderer and Electron bundles build successfully.

# Content Production Agent Team Redesign

Date: 2026-07-07

## Summary

The Enterprise Lead Workspace Agent Team should be redesigned around content
quality. The current team model exposes a broad business workflow with agents
for opportunity detection, sales handoff, risk review, project summary, and
archive. That makes the page look powerful, but it does not clearly improve the
outputs users are asking for most often: topics, copy, short-video scripts,
private-domain messages, and conversion content.

The new model is a smaller **content production team**. It keeps only agents
that directly improve content quality, makes agent selection visible in chat,
and uses a content quality check as the final step for generated content.

The first implementation should remove unnecessary roles from the default
workspace team, migrate existing default bindings to the new content roles, and
keep historical chat and run snapshots readable.

## Problem

The current Agent Team has too many roles for a content-focused workspace:

- Some roles are internal orchestration concepts rather than user-facing
  specialists.
- Some roles focus on lead scoring or project administration instead of content
  output.
- Chat technically supports selecting an agent, but the current product does
  not make agent choice feel like the primary way to improve output quality.
- Users see many agents but cannot easily understand which one improves a
  short-video script, a social post, or a sales message.
- Quality review is mixed with broad risk review, so "make this less generic,
  less AI-like, and more conversion-oriented" is not prominent enough.

## Goals

- Reframe Agent Team as a content production team.
- Improve outputs for topic planning, marketing copy, short-video scripts,
  private-domain messages, and conversion content.
- Make manual agent selection available and easy in chat.
- Keep Auto mode as the default, but make it route through content specialists.
- Use a content quality checker to reduce generic, AI-like, unsupported, or
  low-conversion output.
- Remove or hide agents that do not directly serve content quality.
- Preserve old chat messages and run snapshots.

## Non-Goals

- Do not build a general-purpose agent marketplace.
- Do not keep every legacy enterprise workflow role visible.
- Do not redesign the entire Cowork/OpenClaw agent system.
- Do not require users to understand raw system prompts before using the team.
- Do not make all agent tuning automatic after every answer.
- Do not delete historical task data from existing workspaces.

## New Default Team

The default Agent Team should contain six user-facing content agents.

### Product Selling Point Agent

Purpose: extract the product value that all content should be built on.

Responsibilities:

- Identify product advantages, user pain points, trust signals, and
  differentiation.
- Turn vague product information into usable content angles.
- Provide the source material for topic, script, copy, and conversion agents.

Typical usage:

- "帮我提炼这个产品的核心卖点"
- "这个产品适合打哪些用户痛点"
- "把这些资料整理成短视频可用的卖点"

### Topic Planning Agent

Purpose: generate content topics and angles.

Responsibilities:

- Create topic lists, title options, hook angles, content series, and content
  calendars.
- Adapt topics to platforms such as Douyin, Xiaohongshu, WeChat Channels, and
  private-domain communities.
- Avoid generic topic lists by grounding topics in product selling points and
  target audience pain points.

Typical usage:

- "帮我做 10 个小红书选题"
- "这个产品怎么做一个短视频系列"
- "给我一周朋友圈内容主题"

### Short Video Script Agent

Purpose: produce short-video scripts.

Responsibilities:

- Write short-video hooks, oral scripts, scene beats, shot suggestions, and
  endings.
- Optimize the first three seconds, rhythm, spoken tone, and call to action.
- Support multiple script styles such as educational, testimonial, comparison,
  problem-solution, and live-commerce warm-up.

Typical usage:

- "帮我写一个 60 秒口播脚本"
- "把这个卖点改成抖音短视频脚本"
- "给这个产品写 3 个不同开头"

### Social Copy Agent

Purpose: produce written marketing content.

Responsibilities:

- Write Xiaohongshu posts, WeChat Moments posts, official account outlines,
  poster copy, product seeding copy, and event copy.
- Adjust tone for platform, audience, and conversion stage.
- Keep copy concrete, readable, and less AI-like.

Typical usage:

- "帮我写一条朋友圈文案"
- "帮我写一篇小红书种草文"
- "把这个活动卖点写成海报文案"

### Private-Domain Conversion Agent

Purpose: turn content interest into conversation and sales follow-up.

Responsibilities:

- Write WeChat private-message scripts, group messages, follow-up sequences,
  objection handling, and soft conversion prompts.
- Convert content assets into customer conversation flows.
- Keep the tone natural, non-pushy, and useful.

Typical usage:

- "客户看完内容后我该怎么私聊跟进"
- "帮我写一套社群转化话术"
- "把这篇文案改成微信私聊版本"

### Content Quality Agent

Purpose: review and improve content before the user uses it externally.

Responsibilities:

- Check whether output is generic, AI-like, unsupported, risky, off-brand, or
  missing a conversion point.
- Improve specificity, structure, tone, evidence boundaries, and call to action.
- Produce a revised version instead of only giving comments.

Typical usage:

- "这段文案太像 AI，帮我改自然"
- "检查这个脚本有没有风险"
- "帮我把这条内容改得更能转化"

## Legacy Role Mapping

Legacy default roles should be removed from the visible default team or migrated
into content roles.

| Legacy role             | New handling                                                  | Reason                                                          |
|-------------------------|---------------------------------------------------------------|-----------------------------------------------------------------|
| `controller`            | Remove from visible team; keep orchestration as backend logic | Users should not manage an internal coordinator.                |
| `product_understanding` | Migrate to Product Selling Point Agent                        | This is central to content quality.                             |
| `opportunity_radar`     | Remove from default content team                              | It serves lead scoring, not content production.                 |
| `content_planning`      | Migrate to Topic Planning Agent                               | This remains a core content capability.                         |
| `social_operation`      | Merge into Social Copy Agent and platform adaptation rules    | The role name is operational, while the useful output is copy.  |
| `sales_handoff`         | Migrate to Private-Domain Conversion Agent                    | The useful part is conversion talk and follow-up scripts.       |
| `risk_review`           | Migrate to Content Quality Agent                              | Review should focus on content quality, not a broad risk gate.  |
| `project_summary`       | Remove from default content team                              | Project summary does not directly improve content output.       |
| `project_archive`       | Remove from visible team                                      | Archive is storage/workflow behavior, not a content specialist. |

## Chat Experience

### Composer Agent Control

The chat composer should make agent choice visible and useful.

Default label:

```text
Agent: Auto Team
```

Expanded menu:

```text
Auto Team
Product Selling Point
Topic Planning
Short Video Script
Social Copy
Private-Domain Conversion
Content Quality
```

Behavior:

- Auto Team is the default for new chat sessions.
- Manual selection runs the selected agent directly.
- If the selected agent is disabled or removed, the composer falls back to Auto
  Team and shows no broken selection.
- The selected agent should be carried across turns in the same visible chat
  session until the user changes it or starts a new session.
- The menu should show short descriptions, not internal role ids.

### Auto Team Routing

Auto Team should route content requests through a small, predictable sequence.

Recommended routing:

| User intent                                               | Agent sequence                                                        |
|-----------------------------------------------------------|-----------------------------------------------------------------------|
| Product value, pain points, differentiation               | Product Selling Point                                                 |
| Topic list, content calendar, title ideas                 | Product Selling Point -> Topic Planning -> Content Quality            |
| Short-video script, hook, oral script, storyboard         | Product Selling Point -> Short Video Script -> Content Quality        |
| Xiaohongshu, Moments, official account, poster copy       | Product Selling Point -> Social Copy -> Content Quality               |
| WeChat follow-up, group message, sales objection handling | Product Selling Point -> Private-Domain Conversion -> Content Quality |
| Rewrite, polish, reduce AI tone, review risk              | Content Quality                                                       |

The final answer should feel like one response. The process panel can show which
agents contributed, but the main message should not read like a chain of
separate agents pasted together.

### Output Attribution

Every agent-produced answer should show quiet attribution:

```text
Used Short Video Script + Content Quality
```

For manual selection:

```text
Used Social Copy
```

This should be inspectable, not dominant.

## Agent Team Page

The Agent Team page should be simplified for content production.

Recommended sections:

1. **Team Overview**
  - Six content agents in execution order.
  - Enabled/disabled status.
  - Short responsibility.
  - Last edited status when available.

2. **Agent Details**
  - Name.
  - Responsibility.
  - Best for.
  - Output standards.
  - Tone.
  - Model.
  - Advanced prompt.

3. **Quality Standards**
  - Global content requirements applied to all content agents.
  - Examples: no empty slogans, concrete audience, clear CTA, natural Chinese,
    evidence boundary, platform style.

4. **Test Agent**
  - Prompt box to test one selected agent.
  - Shows the selected agent, model, and whether quality check is included.

The page should avoid presenting agent management as a technical settings table.
It should feel like the user is configuring a compact content team.

## Prompt Design

### Product Selling Point Prompt

The prompt should force concrete extraction:

- Target user.
- User pain.
- Product capability.
- Trust proof or source boundary.
- Differentiation.
- Content-ready angle.

It should avoid broad marketing adjectives without supporting details.

### Topic Planning Prompt

The prompt should require:

- Platform.
- Audience.
- Content goal.
- Topic angle.
- Hook or title.
- Suggested format.
- Why this topic can attract attention.

### Short Video Script Prompt

The prompt should require:

- First three seconds hook.
- Spoken script.
- Scene or shot suggestions.
- Rhythm notes.
- CTA.
- Optional alternative hooks.

### Social Copy Prompt

The prompt should require:

- Platform-specific structure.
- Natural opening.
- Concrete product/user detail.
- Benefit and proof boundary.
- CTA.
- Revised version when polishing.

### Private-Domain Conversion Prompt

The prompt should require:

- Conversation stage.
- Customer concern.
- Message sequence.
- Soft CTA.
- Follow-up option.
- Non-pushy tone.

### Content Quality Prompt

The prompt should review content against a checklist:

- Is it specific?
- Does it sound natural?
- Does it match the platform?
- Does it avoid unsupported claims?
- Does it include a useful conversion point?
- Does the revised version improve the original?

The Content Quality Agent should return both a diagnosis and a polished version
unless the user only asks for a checklist.

## Data Model And Migration

The existing `workspaceAgents` storage can continue to be used. No new table is
required in the first phase.

Recommended changes:

- Replace the default `EnterpriseLeadAgentRole` set for new workspaces with the
  six content roles.
- Keep legacy role ids readable for old records and snapshots.
- When loading a workspace with the old default nine-agent team and no user
  customization, migrate it to the new six-agent content team.
- When loading a workspace with user-edited legacy agents, preserve the edited
  bindings and mark removed default roles as disabled instead of deleting user
  edits silently.
- New runs should snapshot the new content agents.
- Old runs should continue to render from `agentSnapshot` when present.

### Migration Safety Rules

- Do not delete historical chat messages.
- Do not delete historical run tasks.
- Do not mutate `agentSnapshot` on existing tasks.
- Do not remove a user-created workspace agent unless the user explicitly
  removes it.
- Treat system-template defaults differently from user-created or edited
  workspace agents.

## Backend Flow

### Chat

The chat service should:

1. Resolve enabled content agents for the workspace.
2. Respect manual `targetAgentId` first.
3. In Auto Team mode, classify the user request into a content intent.
4. Run the mapped content agent sequence.
5. Use Content Quality as the final step for generated content, except when the
   user explicitly asks for raw brainstorming.
6. Build one final answer from the agent outputs.
7. Store `message.agent`, `message.routing`, and progress events as it does
   today.

### Workflow Runs

The existing run workflow should become content-generation oriented.

Recommended default run:

1. Product Selling Point.
2. Topic Planning.
3. Short Video Script.
4. Social Copy.
5. Private-Domain Conversion.
6. Content Quality.

This run should be presented as "内容生产流程" rather than a generic enterprise
lead workflow.

## Error Handling

- If no enabled content agents exist, Auto Team should fall back to the main
  assistant and show a short recoverable error in the Agent Team page.
- If a manual target agent id is missing or disabled, the request should fall
  back to Auto Team instead of failing.
- If the Content Quality Agent fails, return the primary generated content and
  show that quality check failed in the process panel.
- If model generation fails in one intermediate agent, continue only when the
  remaining result would still be useful; otherwise show a clear failure state.
- If migration detects user-edited legacy agents, preserve them and avoid silent
  deletion.

## Testing

### Unit Tests

- New workspace creation initializes the six content agents.
- Default legacy nine-agent workspace migrates to the new content team.
- User-created workspace agents are preserved during migration.
- Manual chat target routes directly to the selected content agent.
- Auto Team routes topic requests to Product Selling Point -> Topic Planning ->
  Content Quality.
- Auto Team routes short-video requests to Product Selling Point -> Short Video
  Script -> Content Quality.
- Auto Team routes private-domain requests to Product Selling Point ->
  Private-Domain Conversion -> Content Quality.
- Rewrite/polish requests route directly to Content Quality.
- Old run snapshots still render legacy agent names.

### Renderer Tests

- The chat composer shows Auto Team and the six content agents.
- Selecting an agent passes `targetAgentId` to the chat service.
- Removed or disabled selected agents reset the composer to Auto Team.
- The Agent Team page shows the simplified content-team language.
- The process summary displays the content agents used in a completed answer.

### Manual Validation

- Create a new workspace and confirm the Agent Team has six content agents.
- Ask for Xiaohongshu topics and confirm the final answer is topic-focused,
  concrete, and quality-checked.
- Ask for a 60-second short-video script and confirm hook, oral script, beats,
  and CTA are present.
- Ask for WeChat follow-up messages and confirm the tone is natural and not too
  pushy.
- Manually select Content Quality and polish an AI-like draft.
- Open an old workspace and confirm old messages and runs still render.

## Rollout Plan

1. Add the new content role constants, templates, route rules, and labels.
2. Update default workspace creation to use the six-agent team.
3. Add compatibility mapping from legacy roles to content roles.
4. Update chat routing and prompt templates for content-production flows.
5. Update the chat composer to make agent selection prominent and stable.
6. Simplify the Agent Team page copy and layout around content production.
7. Add migration-safe tests for old workspaces and snapshots.
8. Run targeted service, validation, renderer, and changed-file lint checks.

## Acceptance Criteria

- New workspaces show a six-agent content production team, not the old
  nine-agent broad enterprise team.
- Users can manually choose a content agent in chat.
- Auto Team routes common content requests to the correct content sequence.
- Content Quality participates in generated content flows and improves output
  instead of only flagging issues.
- Legacy chats and task snapshots remain readable.
- User-created workspace agents are not silently deleted.
- The Agent Team page explains how each agent improves content output.
- Tests cover creation, migration, routing, selection, and rendering.

# Marketing Agent Factory Profile Memory Design

## Goal

Upgrade `推广agent` from a copywriting-only assistant into a memory-backed
factory promotion assistant that can remember one factory's stable profile and
reuse it in later conversations without asking the same questions again.

The first version assumes:

- One user manages one factory.
- The user does not fill out a form.
- The agent extracts stable factory details from natural-language chat.
- The agent reuses known details when generating promotion content.

## Product Principle

The agent should feel like a long-term promotion helper for the same factory.
After a few conversations, the user should be able to say:

```text
帮我写一条朋友圈
```

And the agent should infer the known context, such as:

```text
东莞重型纸箱厂
目标客户：汽配零部件包装
核心卖点：防破损、替代木箱
渠道：朋友圈
```

The user should not see or maintain a factory profile form in the first version.

## Factory Profile

The first version uses a single implicit factory profile with these fields:

- Region
- Factory name
- Main products
- Service region
- Target customer industries
- Typical application scenarios
- Core selling points
- Channel preferences
- Writing tone preference
- Contact method
- Case materials

All fields are optional. The agent should produce useful output once it has
enough information for the current task, usually:

- Channel
- Product
- Customer industry or application scenario
- One core selling point

The agent must not block generation just because factory name, contact method,
load range, exact delivery time, or price is missing.

## Memory Extraction

When the user provides stable facts, the agent should treat them as profile
memory candidates.

Examples of stable facts:

```text
我们在东莞
主要做重型纸箱
客户多是汽配厂
主要装零部件和大件产品
想突出防破损和替代木箱
我们一般发朋友圈和微信群
```

The agent should naturally confirm newly extracted stable details:

```text
我记住了：你们在东莞，主营重型纸箱，主要服务汽配零部件包装，重点突出防破损。
```

The confirmation should be short and conversational. It should not show a full
table unless the user explicitly asks to view the factory profile.

## Temporary Task Details

Not every user statement should update long-term profile memory.

Temporary task details include:

```text
这次写机械设备客户方向
今天用老板口吻
这条不要留联系方式
先帮我写一条短一点的
```

These should apply only to the current task unless the user says they should be
used long-term.

Long-term update signals include:

```text
以后都按这个方向
我们现在主要做机械设备客户
后面推广重点改成替代木箱
以后朋友圈都用老板口吻
```

## Conflict Handling

If the current message conflicts with remembered factory profile details, the
agent should not silently overwrite memory.

Example:

Remembered profile:

```text
目标客户：汽配厂
```

User says:

```text
这次写机械设备客户
```

Agent behavior:

```text
这次我先按机械设备客户来写，原来记住的汽配客户方向还保留。
```

If the user says:

```text
以后主要改做机械设备客户
```

Then the agent should update the long-term target customer profile.

## Reuse Behavior

Before generating content, the agent should silently combine:

- Current user request
- Known factory profile
- Channel-specific writing rules
- Current task constraints

Then it should confirm the key context in one sentence:

```text
我按你们东莞重型纸箱厂、汽配零部件包装、防破损这个方向来写。
```

If enough context is known, the agent should generate directly.

If one key detail is missing and materially affects output quality, the agent
should ask only one focused question with options:

```text
这条主要想吸引哪类客户？汽配、机械设备、五金电机，还是其他？
```

If the user is clearly asking for immediate output, the agent should generate
with reasonable assumptions first and list one or two optional improvements at
the end.

## Current Prompt Upgrade

The current `推广agent` prompt already contains early memory guidance. It should
be refined around the single-factory model:

- State clearly that this is one factory's profile by default.
- Extract stable profile details from each user message.
- Reuse remembered profile details before asking questions.
- Distinguish long-term profile facts from temporary task details.
- Confirm newly remembered facts briefly.
- Treat conflicts as temporary unless the user says the business direction has
  changed long-term.
- Generate useful content with partial information.

## Out Of Scope For First Version

The first version should not add:

- A visible factory profile form.
- Multi-factory switching.
- CRM-style lead management.
- Publishing automation to WeChat, 1688, or Baidu.
- Complex approval workflows.
- A separate database table for factory profile unless prompt-only memory proves
  insufficient.

## Future Extension

If prompt-level memory is not reliable enough, add a structured factory profile
store later:

```text
Renderer chat
→ Agent message
→ profile extraction service
→ factory_profile table
→ profile summary injected into 推广agent context
```

The structured store can support:

- Viewing the remembered factory profile.
- Editing incorrect remembered details.
- Explicitly clearing or resetting profile memory.
- Exporting a factory promotion brief.
- Connecting profile fields to industry-pack generation tools.

## Success Criteria

The feature is successful when:

- After the user mentions factory basics once, the agent stops repeatedly asking
  for the same basics.
- The agent can generate useful content when the user only provides a short
  follow-up request, such as `帮我写朋友圈`.
- The agent distinguishes temporary campaign targets from long-term factory
  profile changes.
- The agent confirms remembered details in natural language without exposing a
  form-like UI.
- Generated promotion content becomes more specific over time because the agent
  remembers product, customer, scenario, and selling-point context.

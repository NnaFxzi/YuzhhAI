# Domestic Content Platform Research Sources Design

## Goal

Extend `推广agent` so it can use domestic content-platform signals when judging
product positioning, customer pain points, competitor messaging, and promotion
angles.

The target platforms are:

- Xiaohongshu
- Douyin
- Kuaishou
- WeChat Channels
- Bilibili
- WeChat official accounts

The feature should make these platforms configurable and useful without asking
users to understand cookies, environment variables, CLIs, or crawler setup.

## Product Positioning

This is not a generic social-media crawler. It is a research layer for promotion
decisions.

The agent should use platform content to answer business questions:

- Which product should be promoted first?
- Which customer pain points appear most often?
- Which phrases do real customers use?
- Which competitor selling points are repeated and weak?
- Which content angles fit each platform?
- Which evidence supports the final recommendation?

The agent should not promise perfect full-platform coverage. Domestic short-video
platforms have unstable access, login requirements, anti-scraping controls, and
different compliance boundaries. The product should expose capability status
clearly instead of hiding platform failures.

## Recommended Rollout

### Phase 1: Stable MVP

Support:

- Xiaohongshu search when a working logged-in backend is available.
- Bilibili search through existing zero-config tooling.
- WeChat official account and general web article discovery through web search
  and page extraction.
- Manual URL import for Xiaohongshu, Douyin, Kuaishou, WeChat Channels,
  Bilibili, and WeChat articles.
- Platform-aware analysis of titles, text, comments when available, tags,
  engagement numbers when visible, publish time, and source URL.

Do not require full automatic Douyin, Kuaishou, or WeChat Channels search in the
first version.

Reason: link import plus available search backends gives the agent useful data
quickly while avoiding a fragile promise that the app cannot consistently keep.

### Phase 2: Browser Login Connectors

Add visual connection flows for platforms that need login state:

- `连接小红书`
- `连接抖音`
- `连接快手`
- `连接视频号`

The user signs in through a local browser or embedded controlled browser. The
app stores only connection status and the minimum session material needed by the
chosen backend. The UI should show `已连接`, `需要重新登录`, `受限`, or `不可用`.

The agent remains read-only:

- No posting
- No liking
- No commenting
- No following
- No private-message access

### Phase 3: Provider Marketplace

For large-scale or commercial use, allow the user to connect third-party data
providers or official service-provider APIs. These providers can supply more
stable Douyin, Kuaishou, and WeChat Channels data where legally and commercially
available.

This should be added as another provider type, not mixed into the basic browser
login path.

## Data Source Center

Add a visual `调研数据源` area. It can live inside agent settings first, then later
move to a shared settings page if multiple agents need it.

Each platform should appear as a card with:

- Platform name and icon.
- Capability status.
- Connection action.
- Supported collection modes.
- Last checked time.
- Short explanation of limitations.

Example statuses:

- `可用`: the platform can be searched or imported now.
- `仅支持链接导入`: search is not available, but pasted URLs can be analyzed.
- `需要登录`: the platform needs the user to connect a browser session.
- `受限`: the backend exists but current request failed or rate-limited.
- `未支持`: planned, but not enabled in this build.

The UI should not mention command-line setup to ordinary users.

## Platform Capability Matrix

| Platform | Phase 1 Mode | Phase 2 Mode | Notes |
| --- | --- | --- | --- |
| Xiaohongshu | Search if backend is available, plus URL import | Browser login connector | Strong priority for customer language and pain points. |
| Douyin | URL import | Browser login connector or paid provider | Search should not be promised until backend stability is proven. |
| Kuaishou | URL import | Browser login connector or paid provider | Useful for lower-tier market and factory-style content. |
| WeChat Channels | URL import | Browser login connector or paid provider | Access is more constrained; treat as high-risk. |
| Bilibili | Search and URL import | Optional login enhancement | Useful for explainers, reviews, and industry knowledge. |
| WeChat official accounts | Web search, article URL import | Optional provider | Useful for long-form industry content and competitor articles. |

## Unified Source Adapter

Promotion analysis should call a unified adapter interface instead of platform
specific logic directly.

The adapter should expose:

- `checkStatus(sourceId)`
- `search(sourceId, query, options)`
- `extractUrl(sourceId, url, options)`
- `getSupportedModes(sourceId)`

The adapter result should normalize content into a compact record:

```text
sourceId
sourceName
url
title
authorName
publishedAt
text
tags
metrics
comments
collectionMode
confidence
limitations
```

Metrics and comments are optional because many platforms hide or limit them. The
agent should never fail the full report just because one optional field is
missing.

## Research Flow

When the user asks the promotion agent to analyze the main promotion direction,
the agent should:

1. Read the factory profile and candidate product directions.
2. Build platform-specific queries from product names, customer scenarios, and
   pain-point phrases.
3. Check enabled data-source statuses.
4. Search stable sources automatically.
5. Ask for pasted links only when a high-value platform is unavailable and the
   report would benefit from it.
6. Extract normalized source records.
7. Summarize per platform:
   - high-frequency customer pain points;
   - competitor wording;
   - content hooks;
   - objections;
   - channel fit.
8. Feed the summary into the existing positioning scoring model.
9. Save the report with source counts and limitations.

## Main Direction Decision Signals

Domestic content-platform data should influence, but not fully determine, the
main direction.

Recommended signals:

- Pain-point frequency
- Pain-point urgency
- Purchase-intent language
- Competitor sameness
- Content engagement when visible
- Scenario clarity
- Platform-channel fit
- Factory-fit evidence
- Source confidence

The report should separate:

- `证据`: what was found.
- `推断`: what the agent infers from the evidence.
- `限制`: what data was unavailable.

## Manual Link Import

Manual link import is a first-class feature, not a fallback hidden in error
states.

Users should be able to paste:

- A single note or video URL.
- Several competitor URLs.
- A search-result page URL when extraction is possible.
- A text export copied from a platform page.

The agent should label imported sources as `用户提供链接` and include them in the
same normalized source model.

This gives users a simple path for platforms where automatic search is unstable.

## Compliance And Safety

The system should stay read-only and transparent.

Rules:

- Do not automate publishing, liking, commenting, following, or private-message
  access.
- Do not bypass paywalls, private groups, or non-public content.
- Respect platform rate limits and login failures.
- Show data-source limitations in reports.
- Store only compact summaries and source metadata by default.
- Avoid permanently storing large raw page bodies, screenshots, or videos.
- Redact credentials, cookies, and session tokens from logs and prompts.

## Error Handling

Platform failures should be partial failures.

If a platform is unavailable:

- Continue the report with remaining sources.
- Mark the platform as unavailable in the source summary.
- Lower confidence when the missing platform is important.
- Offer a simple next action, such as `粘贴 3 个抖音竞品链接后重新分析`.

The user should never see a generic failure for the full promotion analysis just
because Douyin or WeChat Channels could not be queried.

## First Implementation Boundary

The first implementation should include:

- Shared source/provider types.
- Local persistence for per-agent domestic source settings.
- Agent settings UI for source status and supported modes.
- Manual URL import path.
- Adapter wrapper for existing Xiaohongshu and Bilibili capabilities when
  available.
- Integration with the positioning report source summary.
- Clear report wording for limitations and confidence.

It should not include:

- Full automatic Douyin search.
- Full automatic Kuaishou search.
- Full automatic WeChat Channels search.
- Paid provider marketplace.
- Posting or account-management features.
- Large-scale historical trend tracking.

## Recommended Decisions

- Put `调研数据源` inside `推广agent` settings for the first version. The data
  model should still allow app-level reuse later.
- Support manual URL import in both chat and a structured source panel. Chat is
  fastest for casual users; the panel is better for repeated competitor-link
  batches.
- Do not choose a third-party Douyin/Kuaishou provider in the first version.
  Keep the provider boundary explicit so a commercial provider can be added
  later without changing the agent's research flow.

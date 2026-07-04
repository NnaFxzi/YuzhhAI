# Marketing Agent Positioning Research Design

## Goal

Upgrade `推广agent` with a structured product-positioning research task. The
agent should use external market research plus the remembered factory profile to
recommend which product direction the factory should promote first.

The first version focuses on heavy packaging factories that may sell multiple
related products, such as heavy-duty corrugated cartons, honeycomb cartons,
paper edge protectors, paper pallets, and wooden-box replacement packaging.

## User Outcome

The user should be able to ask naturally:

```text
根据行业、同行、关键词和客户痛点，帮我判断现在主推哪个产品方向
```

The agent should then research several candidate product directions, score each
one, recommend the best main promotion direction, and connect the result to
next-step content generation.

The output should answer:

- What should we promote first?
- Which customer pain points support this direction?
- What are competitors saying?
- Which keywords and channels should we use?
- What factory facts or cases are still missing?
- What content should we generate next?

## Product Principle

This feature is not a general web-research report. It is a decision helper for
factory promotion.

The agent should turn scattered external data into a practical positioning
decision:

```text
主推方向：替代木箱重型包装方案
理由：搜索意图明确、客户痛点强、同行表达同质化、适合多渠道持续输出
下一步：生成百度 SEO 文章、1688 标题、朋友圈案例和一周内容日历
```

## Scope

The first version should support one explicit task: product positioning
analysis for the current factory.

It should:

- Read the existing single-factory profile from memory when available.
- Generate candidate product directions from the heavy packaging industry pack.
- Research external data across search, competitor, and content channels.
- Convert raw findings into a structured research summary.
- Score each candidate with a consistent model.
- Save the positioning report and recommended main direction.
- Reuse the recommended direction in later promotion content.

It should not:

- Automatically publish content.
- Crawl complete 1688 stores.
- Build a CRM or lead-management system.
- Track inquiry conversion in the first version.
- Support multiple factory profiles.
- Store large external page bodies as permanent data.
- Require the user to fill a complex form.
- Require users to configure `TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, or any other
  environment variable.

## External Research Provider Configuration

Tavily and Firecrawl should be built into the product as visual agent settings,
not as environment-variable requirements.

Every agent can configure external research capability. `推广agent` should use it
by default for positioning tasks, while other agents can opt in for research,
procurement, content, or selection workflows.

The first version should support:

- App-level default Tavily and Firecrawl credentials.
- Per-agent external research settings.
- A per-agent option to use app defaults or override them.
- Separate enable switches for Tavily and Firecrawl.
- Masked API key inputs with show, hide, clear, and connection-test actions.
- Clear UI copy that explains these keys are used only for external research.

The implementation must keep credentials outside the model prompt:

- API keys are stored and used by the local app runtime.
- API keys are not written into agent prompts, skill instructions, conversation
  messages, positioning reports, or OpenClaw-visible tool inputs.
- Tools return only search, crawl, extract, and structured-summary results to
  the agent.
- Logs and errors must redact keys.

The recommended default behavior is:

- New custom agents use app defaults unless the user chooses an override.
- `推广agent` has external research enabled when at least one configured provider
  is available.
- If no provider key is configured, the agent should ask the user to open the
  visual settings instead of mentioning environment variables.

## Data Sources

The first version uses three research lanes. Each lane is optional at runtime:
if one source fails or is unavailable, the analysis continues with the remaining
sources and marks the confidence accordingly.

Tavily is the preferred provider for real-time web search, keyword discovery,
and broad page discovery. Tavily's current documentation exposes web search,
extract, crawl, map, and research capabilities.

Firecrawl is the preferred provider for page scraping, batch extraction,
structured extraction, crawl jobs, and content analysis. Firecrawl's current
documentation exposes search, scrape, crawl, map, and structured-output style
workflows.

### Search And Keyword Lane

Purpose: identify active customer demand and purchase intent.

Examples:

- `重型纸箱厂家`
- `替代木箱包装`
- `出口免熏蒸包装`
- `蜂窝纸箱承重`
- `机械设备包装`

The research summary should extract:

- Keywords
- Search intent
- Common customer questions
- Purchase-oriented phrases
- Pain points implied by search behavior

### 1688 And Competitor Lane

Purpose: understand how peers sell similar products.

The research summary should extract:

- Competitor title patterns
- Main products
- Repeated selling points
- Parameter and price wording
- MOQ or delivery wording when visible
- Differentiation gaps

The first version should summarize competitor patterns instead of storing full
shop pages.

### Content Platform Lane

Purpose: understand pain points, scenarios, and language suitable for content.

Relevant platforms can include Xiaohongshu, short-video platforms, Bilibili, and
general web content. The exact available platforms depend on the installed
research backend and logged-in state.

The research summary should extract:

- Customer pain points
- Common scenarios
- Content hooks
- Objections or doubts
- Practical language that can be adapted for WeChat, short video, or case posts

## Candidate Product Directions

By default, the agent should evaluate these directions from the heavy packaging
industry pack:

- Heavy-duty corrugated cartons
- Honeycomb cartons
- Paper edge protectors
- Paper pallets
- Wooden-box replacement packaging
- Case-based solution directions, such as auto-parts packaging, machinery
  equipment packaging, export packaging, or large-product transportation
  packaging

If the user names specific products, the analysis should narrow to those
products. If the factory profile already contains strong product preferences,
the agent can prioritize those candidates but should still explain why other
directions rank lower.

## Structured Research Summary

Each candidate direction should produce a compact summary:

```text
产品方向：替代木箱重型纸箱
关键词：替代木箱包装、出口免熏蒸、重型纸箱厂家
客户痛点：木箱成本高、出口熏蒸麻烦、运输破损
同行卖点：承重、定制、打样、交期、厂家直销
机会点：多数同行讲产品参数，少数讲整体降本方案
置信度：中
```

The summary should be saved, but raw external page bodies should not be saved as
long-term data.

## Scoring Model

Each candidate gets five scores from 1 to 5.

### Market Demand

Measures keyword demand, purchase intent, and pain-point strength.

High-scoring signs:

- Keywords indicate active procurement.
- Customers are solving urgent business problems.
- Search language is specific rather than vague.

### Competitive Opportunity

Measures differentiation space, not raw competitor count.

High-scoring signs:

- Competitors repeat generic wording such as `厂家直销` or `可定制`.
- The factory can present a clearer solution angle.
- The market has visible demand but weak content positioning.

### Factory Fit

Measures fit with the remembered factory profile.

Inputs include:

- Products the factory can deliver
- Known cases
- Load range
- Lead time
- Service region
- Sales materials
- Existing selling points

If factory data is thin, the score can be moderate or low, and the report should
state which missing facts would increase confidence.

### Deal Feasibility

Measures whether the direction can lead to practical inquiries.

High-scoring signs:

- Customer scenario is concrete.
- Purchase criteria are understandable.
- A short article or sales message can lead to consultation.
- The direction does not require excessive technical education before inquiry.

### Content Expansion

Measures whether the direction can support repeated content across channels.

High-scoring signs:

- Can produce WeChat Moments, WeChat group, 1688, Baidu SEO, short-video, and
  referral content.
- Can support multiple themes such as pain points, cases, parameter education,
  comparison, and procurement guidance.

## Recommendation Output

The final report should include:

- Recommended main direction
- Total score
- Score table or score list
- Recommendation reasons
- Suitable channels
- First-week content themes
- Missing factory facts or case materials
- Backup directions
- Next actions

Example:

```text
推荐主推：替代木箱重型包装方案，综合 22/25

原因：
- 搜索词有明确采购意图：替代木箱、出口免熏蒸、重型纸箱厂家
- 同行多讲产品参数，方案型表达有差异化空间
- 能同时覆盖百度 SEO、1688、朋友圈案例和微信群短句
- 如果补充 1-2 个客户案例，成交说服力会明显增强

备选方向：
1. 蜂窝纸箱：适合做承重/轻量化内容
2. 纸护角/纸托盘：适合作为配套产品，不建议单独主推
```

## Agent Workflow

1. User asks for product positioning or main promotion direction analysis.
2. Agent checks whether external research is enabled for the current agent.
3. If credentials are missing, the agent asks the user to configure Tavily or
   Firecrawl in the visual agent settings.
4. Agent reads the known factory profile and remembered promotion direction.
5. Agent determines candidate product directions.
6. Agent uses Tavily for keyword, industry, competitor, and content discovery
   when available.
7. Agent uses Firecrawl for page scraping, batch extraction, and structured
   content extraction when available.
8. Agent runs any remaining built-in research lanes that are available.
9. Agent converts findings into structured summaries.
10. Agent scores candidates with the five-factor model.
11. Agent recommends one main direction and backup directions.
12. Agent saves the positioning report and recommended direction.
13. Agent offers next-step content generation options.

## Data Persistence

The first version should save:

- Positioning report ID
- Pack ID
- Agent ID
- Candidate product directions
- Structured research summaries
- Scores and reasons
- Recommended main direction
- Backup directions
- Recommended channels
- Missing factory facts
- Created timestamp
- Research source timestamps
- Provider availability and source counts

The first version should not save raw API keys, full long-term page bodies, or
credentials inside positioning reports.

The recommended main direction should be available to later content-generation
tasks. When the user later says:

```text
帮我写一条朋友圈
```

The agent can say:

```text
我按之前推荐的“替代木箱重型包装方案”方向来写。
```

External research data should include timestamps because keyword and competitor
language can change.

## Error Handling And Confidence

The agent should not fail the whole task when a source is unavailable.

Expected behavior:

- If search works but 1688 does not, continue and mark competitor confidence as
  low.
- If content platforms are unavailable, continue with keyword and competitor
  findings.
- If factory profile data is sparse, still recommend a direction, but list the
  missing facts that would improve scoring.
- If Tavily is configured and Firecrawl is not, continue with search-heavy
  findings and mark page-extraction confidence lower.
- If Firecrawl is configured and Tavily is not, continue from user-provided
  products, known websites, and scrape/extract results, and mark keyword
  coverage lower.
- If neither Tavily nor Firecrawl is configured, show a visual-settings action
  path and allow a low-confidence industry-pack fallback.
- If all external research fails, fall back to the industry pack and factory
  profile, and clearly state that the recommendation is low-confidence.

## Integration With Existing System

The feature should build on existing LobsterAI structures:

- `推广agent` remains the user-facing entry point.
- External research settings belong to all agents, not only `推广agent`.
- The heavy packaging industry pack supplies candidate products, channels, and
  content themes.
- Industry generation assets can reuse the recommended direction.
- A small positioning-report store can live beside the existing industry pack
  workspace data instead of introducing a broad CRM layer.
- Tavily and Firecrawl calls should be owned by main-process or bridge-side
  services that can read local credentials without exposing them to the model.
- OpenClaw tools should accept research intent and return structured data; they
  should not require the model to pass provider API keys.

The first implementation should prefer a focused domain module over changes
inside large UI or main-process files.

## Testing

Test coverage should verify:

- Candidate directions are generated from the industry pack.
- Scores are normalized and persisted.
- Missing research lanes lower confidence without failing the whole analysis.
- Reports can be read back and reused for later generation.
- The recommended main direction is included in prompt/context for later content
  generation.
- The preset marketing agent prompt mentions product-positioning analysis,
  structured external research, and main-direction reuse.
- Agent external research settings persist app defaults and per-agent overrides.
- Renderer UI masks, clears, and saves Tavily and Firecrawl API keys without
  putting them in prompt text.
- OpenClaw research tools can run without environment variables.
- Missing Tavily or Firecrawl credentials produce a user-friendly configuration
  path instead of a technical environment-variable error.

## Success Criteria

The feature is successful when:

- The user can ask one natural-language question and receive a practical main
  promotion recommendation.
- The report explains market demand, competitor language, customer pain points,
  factory fit, and next content actions.
- The agent can continue from the recommendation into actual promotion content.
- Results are structured enough to save and reuse.
- Partial external data failures do not block useful analysis.
- Users configure Tavily and Firecrawl from the UI, and no environment-variable
  setup is required.

# Local Independent Cloud-Off Design

## Goal

Ship `宇智汇和 AI 助手` as a local independent desktop app that does not make default requests to Youdao/LobsterAI services, while preserving locally usable features.

## Scope

Disable or bypass default requests to:

- `lobsterai-server.youdao.com`
- `lobsterai-server.inner.youdao.com`
- `api-overmind.youdao.com`
- `lobsterai.youdao.com`
- `lobsterai.inner.youdao.com`
- `rlogs.youdao.com`

Keep working:

- User-configured model providers and OpenAI-compatible endpoints.
- Ollama, LM Studio, MCP, local skills, local plugins, OpenClaw runtime, scheduled tasks, local artifacts, local projects, and IM gateway code paths that use user-provided credentials.

## Architecture

Add a small cloud capability layer that makes legacy cloud services explicit and disabled by default. Callers must check these helpers before fetching cloud-only URLs. Cloud-only features return a graceful disabled result instead of attempting network access.

The first implementation pass focuses on request prevention and graceful UI behavior. It does not delete large modules or provider IDs that are still used as internal compatibility names.

## Behavior

- Usage analytics is disabled by default and `reportYdAnalyzer()` becomes a no-op when the legacy analytics endpoint is disabled.
- Renderer and main endpoint helpers no longer expose Youdao/LobsterAI URLs by default.
- Login URL fetching does not call Overmind. Account login returns a local-independent disabled message unless a future self-hosted auth endpoint is configured.
- Auto update checks are skipped when update endpoints are disabled.
- Skill, Kit, and MCP marketplace fetches return empty/disabled results instead of fetching Youdao endpoints.
- Portal links point to `https://www.yuzhh.com` informational pages or are not opened for cloud-only flows.

## Services To Implement Later For A Full Hosted Product

- Auth service: login URL, OAuth callback exchange, refresh tokens, user profile, quota.
- Model gateway service: server model catalog, token proxy, quota updates, media generation if cloud media is desired.
- Update service: app update metadata and installer download URLs.
- Marketplace services: Skill store, Kit store, MCP marketplace.
- HTML/artifact share service: upload, public share URL, access mode, status, listing.
- Analytics service: event ingestion endpoint if usage telemetry is desired.
- Documentation portal: IM setup guides, billing/pricing/profile pages, support/community pages.

## Risks

- Some UI components currently assume account/cloud features exist. They must fail softly instead of showing broken links.
- Tests referencing legacy endpoints need updates to assert disabled/default-local behavior.
- Internal names such as `lobsterai-server` and `lobsterai_image_generate` may remain where changing them would break OpenClaw/provider compatibility.

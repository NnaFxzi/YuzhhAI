# Two-Layer Runtime Commercial Release Design

## Summary

This design prepares the app for a commercial macOS and Windows release under
the "宇智汇和 AI 助手" product brand. The app will use a two-layer runtime
strategy:

- Product layer: "宇智汇和 AI 助手" owns the user experience, packaging,
  legal documents, local-first behavior, update policy, and distribution.
- Runtime layer: "宇智汇和运行时" / "Yuzhh Runtime" is the user-facing bundled
  runtime. It may contain OpenClaw components internally, but packaged apps
  must not expose the legacy `cfmind` name.

The first commercial release targets macOS and Windows. Automatic updates are
disabled for the first release; users download new versions manually from the
official website.

## Goals

- Package the bundled runtime as `yuzhh-runtime` instead of `cfmind`.
- Remove `cfmind` from user-visible UI and packaged application resources.
- Keep `openclaw` as an internal technical integration name where it reduces
  risk and preserves the upstream upgrade path.
- Clearly disclose OpenClaw components in third-party notices and open-source
  license surfaces.
- Support macOS and Windows commercial release packaging.
- Keep automatic updates disabled for the first release.
- Provide a repeatable release verification checklist.

## Non-Goals

- Do not fork OpenClaw into a fully renamed source-level runtime in this phase.
- Do not rename every internal `openclaw` or historical `cowork` source symbol.
- Do not implement a self-hosted update server in the first release.
- Do not re-enable legacy Youdao or LobsterAI cloud services.
- Do not hide OpenClaw license obligations from compliance surfaces.

## Chosen Approach

Use the publish-level self-owned runtime approach.

The app presents a fully self-owned product and runtime to users and in release
artifacts. Internally, the codebase may still use OpenClaw integration modules,
scripts, and vendor paths. This keeps the product ready for commercial
distribution while preserving the ability to accept upstream OpenClaw fixes.

Alternative approaches considered:

- Minimal release rename: faster, but leaves packaging and compliance gaps.
- Source-level fork rename: more complete cosmetically, but too risky for the
  first commercial release and likely to break the upstream maintenance path.

## Runtime Branding

Add a centralized runtime and distribution brand model. Suggested values:

- Runtime display name, Chinese: `宇智汇和运行时`
- Runtime display name, English: `Yuzhh Runtime`
- Packaged runtime directory: `yuzhh-runtime`
- Legacy packaged runtime directory: `cfmind`
- Upstream runtime component: `OpenClaw`
- Product name: `宇智汇和 AI 助手`
- Publisher: `宇智汇和（东莞）科技有限公司`

All user-facing runtime error messages and release packaging paths should use
the brand model rather than hardcoded strings.

## Runtime Directory Behavior

Packaged apps should resolve the bundled runtime in this order:

1. `yuzhh-runtime`
2. `cfmind` as a temporary compatibility fallback

The fallback exists only to avoid breaking old development outputs during the
transition. User-facing text must still say "宇智汇和运行时" and must not mention
`cfmind`.

Development-time paths such as `vendor/openclaw-runtime/current` may remain
unchanged. The packaging step copies the current runtime into the branded
release directory.

## User-Facing Messages

Replace user-facing runtime messages such as:

> 未检测到内置 OpenClaw 运行时（cfmind），请先执行打包前构建脚本。

with:

> 未检测到内置宇智汇和运行时，请先完成运行时构建或重新安装应用。

Developer logs may keep module tags such as `[OpenClaw]` when they refer to the
internal integration layer.

## macOS Packaging

The first macOS release should target Apple Silicon first, with Intel or
universal builds added when needed.

Expected artifact:

- `宇智汇和 AI 助手-{version}-arm64.dmg`

Required packaging properties:

- Product name: `宇智汇和 AI 助手`
- App ID: `com.yuzhh.ai-assistant`
- Icon: current Yuzhh icon assets
- Runtime path: `Contents/Resources/yuzhh-runtime`
- Hardened runtime enabled for signed release builds
- Apple Developer ID Application signing for public distribution
- Apple notarization for public distribution
- Stapled notarization result for released artifacts

Unsigned local test builds may still be allowed for development, but release
checklists must distinguish unsigned test artifacts from public release
artifacts.

## Windows Packaging

Expected artifact:

- `宇智汇和 AI 助手 Setup {version}.exe`

Required packaging properties:

- Product name: `宇智汇和 AI 助手`
- App ID: `com.yuzhh.ai-assistant`
- Publisher name: `宇智汇和（东莞）科技有限公司`
- Icon: current Yuzhh `.ico` assets
- Runtime path: `resources/yuzhh-runtime`
- Signed application executable for public distribution
- Signed installer and uninstaller for public distribution

Windows signing credentials must be injected through environment variables or
CI secrets. They must not be committed to the repository.

## Automatic Update Policy

Automatic updates remain disabled for the first commercial release.

The application may link users to the official website download page, but it
must not perform update checks against legacy cloud endpoints. A self-hosted
update service can be introduced in a later phase after signing, notarization,
and packaging are stable.

## Legal And Compliance Surfaces

The release should include these files or equivalent in-app surfaces:

- `LICENSE`
- `NOTICE.md`
- `THIRD_PARTY_NOTICES.md`
- `PRIVACY.md`
- `TERMS.md`
- `SECURITY.md`

The OpenClaw disclosure should be explicit:

> 宇智汇和运行时包含 OpenClaw 开源组件。OpenClaw 基于 MIT License 授权，相关版权声明和许可文本见第三方开源声明。

This statement should appear in:

- third-party notices
- in-app open-source license surface
- packaged legal resources
- website legal/download documentation when available

## Privacy Requirements

The privacy policy should state:

- The app runs locally by default and does not require login.
- Project files, sessions, logs, and local data are stored on the user's device
  by default.
- Log upload and analytics are disabled by default.
- Model requests go to the provider configured by the user.
- IM channels, MCP servers, skills, and plugins may send data to external
  services when the user configures them.
- Skills, plugins, and MCP servers can access local files or networks depending
  on granted permissions.

## Terms Requirements

The terms should state:

- AI output may be inaccurate.
- Users are responsible for their inputs, configured providers, and use of
  generated outputs.
- Third-party model providers are governed by their own terms.
- Local command execution, file access, skills, plugins, and MCP servers carry
  operational and security risks.
- Commercial licensing terms may be handled by separate agreements for
  enterprise customers.

## Security Requirements

The security documentation should state:

- How to report vulnerabilities.
- Remote marketplaces are disabled by default in the local-first release.
- Automatic updates are disabled in the first release.
- Users should not install untrusted skills, plugins, or MCP servers.
- The runtime can execute local actions, so permission prompts and sandbox
  configuration must be treated as security boundaries.

## Implementation Phases

### Phase 1: Runtime Brand Layer

- Add centralized runtime and distribution brand constants.
- Replace user-facing `OpenClaw/cfmind` runtime text with branded runtime text.
- Prefer `yuzhh-runtime` in packaged runtime path resolution.
- Keep `cfmind` as a compatibility fallback.
- Add tests for the default runtime directory and user-facing message behavior.

### Phase 2: Packaged Runtime Directory

- Update packaging configuration to copy runtime resources into
  `yuzhh-runtime`.
- Update runtime path resolution for macOS and Windows packaged apps.
- Ensure development paths still work.
- Add release artifact checks for `yuzhh-runtime` and absence of `cfmind`.

### Phase 3: Legal Files And About Surface

- Add or update legal documents.
- Add in-app links or views for open-source notices, privacy policy, and terms.
- Include legal files in packaged resources.
- Confirm OpenClaw MIT disclosure is present.

### Phase 4: macOS And Windows Release Configuration

- Confirm app ID, product name, publisher, icon, and artifact names.
- Configure macOS signing and notarization fields without committing secrets.
- Configure Windows signing fields without committing secrets.
- Keep unsigned local packaging available for development.
- Document the release process.

### Phase 5: Release Verification

- Scan source and packaged artifacts for old user-facing brands.
- Scan packaged artifacts for `cfmind`.
- Scan cloud endpoints to confirm legacy services remain disabled.
- Verify the app starts with the bundled runtime.
- Verify first launch does not require login.
- Verify local model configuration works.
- Verify legal documents are present in the app and package.
- Verify automatic update checks are disabled.

## Testing Strategy

- Unit tests for runtime brand constants and path resolution.
- Unit tests for update-disabled behavior.
- Targeted tests around runtime readiness error messages.
- Electron compile check after main-process changes.
- Renderer build check after UI/legal surface changes.
- Manual macOS packaged app launch check.
- Manual Windows packaged installer check on a Windows machine or VM.
- Release artifact scan for `cfmind`, old cloud domains, and old product names.

## Acceptance Criteria

- Packaged macOS app contains `Contents/Resources/yuzhh-runtime`.
- Packaged Windows app contains `resources/yuzhh-runtime`.
- Packaged artifacts do not contain a `cfmind` runtime directory.
- User-facing UI and runtime errors do not mention `cfmind`.
- Internal developer logs may still mention OpenClaw.
- Automatic update checks remain disabled.
- OpenClaw MIT disclosure is present in third-party notices and the in-app
  legal surface.
- macOS and Windows unsigned test packages can be produced locally.
- Signed macOS and Windows release packages can be produced when credentials
  are provided through environment variables or CI secrets.

## Open Questions

- The final public download domain should be confirmed before release.
- The final legal text should be reviewed by counsel before public commercial
  distribution.
- The Windows signing provider should be chosen before the first public Windows
  release.
- A self-hosted update service can be designed after the first manual-download
  release is stable.

# Independent AI Knowledge Model Contract Repair Design

Date: 2026-07-14

## Context

The Plan 3 Electron acceptance run reached the real knowledge-enrichment worker but failed three
times for the same indexed XLSX document: `invalid_model_response`,
`evidence_validation_failed`, then `invalid_model_response`. The document, version, local parser,
index, authorization, locked route, and OpenAI-compatible DeepSeek response envelope were healthy.
At least one response parsed as the exact `{ "facts": [...] }` envelope, but every returned
candidate failed the local evidence contract.

The local validator intentionally fails closed. It requires an exact chunk ID, a bounded fact
value, a bounded quote owned by the supplied chunk, an allowed domain, and a numeric confidence.
The generation prompt does not currently communicate all of those requirements. The model adapter
also discards `finish_reason`, so a length-truncated completion cannot be distinguished safely.

## Approved Scope

The repair aligns generation with the existing validator without weakening evidence ownership:

1. The static system prompt must state that `chunkId` is copied byte-for-byte from the input and
   that `quote` is a short, continuous, verbatim substring of `content`—never a summary,
   translation, reconstruction, or normalized variant.
2. The prompt must state the existing bounds: at most 50 facts per call, value length at most 2,000
   UTF-16 code units, quote length at most 1,000 UTF-16 code units, and confidence from 0 to 1.
3. The prompt must direct the model to extract reusable enterprise facts rather than enumerate
   transaction rows, omit any candidate that cannot satisfy every rule, and return exactly
   `{ "facts": [] }` when no supported fact exists.
4. The prompt must include static valid JSON examples without embedding document content, paths,
   provider configuration, credentials, or real chunk IDs. The user prompt remains exactly
   `JSON.stringify({ chunkId, content })`.
5. Knowledge-enrichment model calls use `temperature: 0`; no adapter-wide default changes.
6. The OpenAI-compatible adapter exposes the first choice's optional `finish_reason` as a bounded
   allowlisted result value. A `length` completion is rejected by the knowledge-enrichment service
   as the existing safe `invalid_model_response` before validation or publication.
7. Every authorized planned model call still produces at most one outbound request. There is no
   automatic format repair, fallback, or hidden retry.

## Deliberate Non-Goals

- Do not relax exact root keys, candidate keys, domain, chunk identity, quote ownership, or length
  validation.
- Do not unwrap Markdown code fences or extract JSON from surrounding prose. The approved Task 5
  direct-`JSON.parse` boundary remains unchanged.
- Do not add or send `response_format`. Structured-output support requires a separate explicit
  provider/model capability that participates in the locked route and routing fingerprint.
- Do not persist or log prompts, document chunks, raw provider responses, credentials, endpoints,
  evidence failures, or parser errors.
- Do not add provider-specific retries or change renderer/IPC DTOs.

## Data Flow

The validator builds the aligned static system prompt and the existing bounded JSON user prompt.
The service calls the already locked model route once with temperature zero and the existing token,
byte, timeout, and abort limits. The adapter parses the provider envelope and returns text plus a
safe finish-reason enum. The service rejects `length` before invoking the strict response validator;
otherwise the current validation, candidate selection, and atomic publication path is unchanged.

## Error Handling and Privacy

`finish_reason: "length"` maps to `invalid_model_response`. Missing, `stop`, or unknown finish
reasons preserve compatibility; unknown provider strings are not copied into the public result.
No raw response or finish-reason string enters persistence or renderer-visible error details.
Failure remains retryable only through the existing explicit user action and authorization flow.

## Acceptance

- RED tests prove every new prompt clause, temperature zero, safe finish-reason normalization,
  rejection-before-publication, and exactly one outbound request.
- Existing strict JSON/evidence tests remain green, including rejection of code fences, prose,
  foreign chunk IDs, and non-owned quotes.
- A two-chunk fake-model success test publishes bounded facts/evidence without extra calls.
- Touched-file strict ESLint, focused Vitest, official `npm test`, renderer build, Electron compile,
  diff checks, Plan 3 package regeneration, and independent specification/code reviews pass.
- A later real-model retry is performed only by the user or after action-time consent because it
  transmits local document content to the selected provider.

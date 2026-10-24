# Safeguard's single ACA enrollment workflow

Implementation proposal, 2026-10-24. No production changes, imports, or live provider calls were made to prepare this change. Do not activate both the Base44 wizard and Hub PR #5 as independent enrollment queues.

## Record authority

- **Hub clients:** persistent Safeguard identity and office/team context. Creating an insurance prospect does not require creating a tax return. The ACA coverage year is independent of the Hub's tax-season toggle.
- **This enrollment application:** one reconciled ACA case for a Hub client and coverage year, authenticated agent ownership, resumable intake, assistance consent events, and HealthSherpa handoff tracking.
- **HealthSherpa:** Marketplace eligibility review, plan selection, final submission and provider-reported enrollment outcomes. A saved intake, returned quote, or created session is not a submitted application or effectuated policy.
- **Base44:** preserve existing leads, clients, quotes, documents and enrollment records. Its HealthSherpa ONE function is the historical integration reference; no records are automatically copied or deleted.

The source-of-truth proposal is implemented behind disabled feature flags; enabling production remains a separate release decision. The Hub remains unchanged. Cross-application status synchronization is not claimed or activated by this PR.

## What was reconciled

Reviewed GitHub: enrollment main `d169a5799d53f79beb903a9da3f4ed234e8aa09b`; Hub main `5dd9301f935c200ce3eb33b106a798eb266eb289`; Hub PR #5 head `3bd27f9b0bde81b198b438bc9ce4ff32daf4e272`. Base44 app: Safeguard Enrollment (`6a99d05178d20504b6118f64`), `base44/functions/healthsherpa/entry.ts`, `src/pages/Quotes.jsx`, `src/pages/EnrollmentWizard.jsx`, and Client/Lead/Enrollment entities.

| Concern | Azure implementation before this change | Hub PR #5 | Base44 app | Proposed handling |
| --- | --- | --- | --- | --- |
| Identity | Independent `leads`, `lead_intakes`, `clients` | Existing `clients.id`, office FK | Independent Client/Lead/Enrollment IDs | Reviewed `enrollment_cases` links; never match/merge automatically by phone/email |
| Year | Intake coverage year; applications schema | Unique client/year; 2027 view | Enrollment schema has no explicit plan-year field | Immutable case coverage year, one case per linked Hub client/year; verify legacy year manually |
| Stages | new/contacted/intake/quoted/enrolled/closed | new_lead/contacted/consent_sent/docs_requested/appointment_booked/enrollment_in_progress/submitted/dmi_pending/effectuated/not_now | Lead: new/contacted/quoted/enrolled/lost; Enrollment: draft/household/income/plan_selected/documents/submitted/completed | Intake remains intake; handoff has its own operational status. Never infer final outcomes from a local stage |
| Consent | Collection/assistance checkbox, original timestamp/actor | signed/sent/revoked state and timeline | Document category, no consent gate in wizard | Additional assistance evidence reference, actor, timestamp, append-only event history; revocation blocks future requests |
| Ownership | Entra roles; own leads or admin | Supabase MFA; owner/manager; owner-only licensed steps | Base44 auth and agency-wide entity RLS | Existing Entra lead scope retained; admin-only reconciliation; exact configured OAuth-linked agent for handoffs |
| Outcomes | Intake does not create applications | Manual submission/carrier/plan/premium; manual effectuation | Submit button only writes local `submitted` | Provider confirmation required. No automatic historical stage conversion |

Do not translate Hub owner -> Entra admin -> licensed agent automatically. Base44 assigned_agent_id is not a row-level restriction in the reviewed schemas: same-agency access is broader than Azure's lead-owner scope. Hub user IDs, Base44 IDs, and Entra IDs are distinct; email matching alone grants no permission.

## Staff workflow in this branch

1. Open or resume the existing lead's intake. Complete and save the intake; this remains `ready_for_quote`, not enrollment submission.
2. Open or resume its enrollment case. Retrying uses the same case ID.
3. Record documented Marketplace assistance consent with an evidence reference. Do not mark consent merely because an old intake checkbox or Base44 `submitted` value exists. Evidence reference points to the restricted signed/recorded artifact; no document body goes in logs.
4. An administrator reviews Hub identity, office, coverage year and any Base44 enrollment ID. The unique Hub client/year and Base44 reference prevent a second linked enrollment case. Existing links cannot be reassigned through this API. A conflict retains both original records and requires review.
5. Resolve saved ZIP to counties; the user chooses the county. Add explicit ages/relationships/tobacco answers for everyone applying, then request quotes. Saved household size, income and coverage year are authoritative. Quote results are not stored as raw PII-bearing payloads.
6. The configured HealthSherpa-linked agent creates or resumes an agent-assisted session. **Only geography is prefilled in this first safe handoff**, plus an opaque case ID for correlation. The agent must enter/review contact, household, consent, documents and plan details inside HealthSherpa. The local quote is not silently selected or copied into the application.
7. Continue in HealthSherpa to complete application review and final submission. Staff use the existing HealthSherpa case for DMI/document follow-up and confirmed coverage outcomes until status readback is explicitly released. Hub PR #5 should later show a projection of the same case, not another independent editable pipeline.

No production contact data is needed to test these routes. A second unlinked intake can still exist under another lead ID: reconciliation blocks it from receiving another handoff for the same Hub client/year. This is a conflict-review mechanism, not a household identity matcher.

## Duplicate and failure behavior

- Session creation uses one persisted server-generated idempotency key per case. The caller cannot choose/reset it.
- Repeated successful requests return the same validated HealthSherpa URL without another provider session call.
- Concurrent/pending or uncertain requests are blocked. Timeout, unsafe/malformed response, correlation mismatch or persistence failure moves the operation to `review_required` when storage is available. A process crash can leave `pending`; that also blocks retries.
- If status persistence itself fails, the reserved pending row remains the recovery anchor. Do not delete it or generate a fresh key to retry blindly.
- Review in HealthSherpa first, then repair local tracking through an explicitly reviewed operation. There is deliberately no reset/delete endpoint.
- Consent changes during a request withhold its result. Revoking local consent cannot revoke a provider link already received or an application already submitted; handle those in HealthSherpa.
- Names, ZIPs, income, DOBs, provider payloads and returned URLs are not included in audit metadata or error logs. All responses are private/no-store; provider requests never follow redirects.

## HealthSherpa contract and release boundary

References checked against official documentation:

- https://one.healthsherpa.com/openapi.json
- https://one.healthsherpa.com/docs/api-reference.html
- https://one.healthsherpa.com/legal/integration-security.html

Use `x-api-key`, `/v1/reference/counties`, `/v1/quotes`, and approval-gated `/v1/enrollment-sessions`. The old Bearer `/quotes` gateway and Base44's flat quote request body are not the current canonical quote contract.

On-exchange sessions return hosted links; they do not submit final enrollment. Direct `/v1/enrollments` is a separate off-exchange product and is intentionally not used here. No public webhook is documented; do not invent webhook status synchronization. Provider policy-status endpoints require approval and linked OAuth and can return incomplete data. This PR does not query policy-status records, label `active` as `effectuated`, or change historical outcomes.

The security guide documents a staging origin and separate keys. Another introductory page says there is no separate public sandbox: do not equate staging configuration with enrollment-testing permission. Confirm the permitted environment with HealthSherpa before synthetic enrollment-session tests. Local tests mock HealthSherpa and never call it.

## Setup and preservation checklist

1. Back up and inventory records through an authorized production workflow before any future migration. Record counts, IDs, source, coverage year, owner, consent evidence and existing HealthSherpa work. This branch did not inspect production data or perform that inventory.
2. Apply `001_initial.sql`, `002_intake.sql`, then additive `003_enrollment_workflow.sql` to an isolated PostgreSQL database only. No migrations execute at startup. Original tables/rows are not rewritten.
3. Configure a separate staging key in server secrets, approved origin, `HEALTHSHERPA_WORKFLOW_ENABLED=true` only in the isolated environment. Verify Entra authentication and lead isolation on Azure. The runtime database role should have access only to this application's tables, not the Hub database.
4. Keep enrollment sessions disabled until HealthSherpa approves the capability, Marketplace OAuth is linked, and the exact Entra agent ID is configured. The global key supports **one explicitly linked agent**; multi-agent enrollment requires per-agent credential/OAuth routing before expanding access. Admin does not bypass this gate.
5. Reconcile records using the admin-only link action; it records who reviewed the link. This is an explicit operator assertion, not a live Hub ID lookup. Verify the office and client in Hub before linking; UUID format checks cannot prove they exist remotely. Do not grant Hub data access based on these local references.
6. Establish Hub-side identity mapping and a scoped authenticated status read endpoint before building a Hub projection. No direct cross-database credential sharing, unrestricted sync, import, or remote role mapping is included in this branch.
7. After source-of-truth approval and end-to-end verification, enable one staff enrollment entry point and make legacy entry points read-only/redirects through separately reviewed changes. Do not delete or mark historical records completed.

## Validation

Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e`. Tests use fictional households and disposable PGlite storage. Live credentials are not required and live HealthSherpa enrollment is not exercised. The GitHub branch/PR does not deploy Azure or apply any database migration.

### Results for this branch

- `npm test`: 19 passed across intake persistence and enrollment workflow tests, including timeout recovery, revocation during a provider request and audit failure after remote success.
- `npm run lint` and `npm run build`: passed, including TypeScript and route generation.
- `npm run test:e2e`: blocked before browser launch because Chromium is absent. `npx playwright install chromium` failed: the downloaded archive was invalid/truncated. The three browser scenarios have not been verified in this environment. Do not treat this branch as production-ready based on backend tests alone.
- No live HealthSherpa ping, quote, enrollment session, policy-status request, or Azure/Hub/Base44 production mutation was performed.

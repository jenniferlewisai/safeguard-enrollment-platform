# Safeguard Enrollment Platform

Secure ACA lead, quoting, enrollment, and client-management platform for Safeguard Financial & Insurance Group.

## MVP foundation

- Agent dashboard, lead pipeline, client book, and ACA household intake UI
- Azure App Service Authentication header support with `admin`, `agent`, and `viewer` authorization boundaries
- PostgreSQL schema for users, leads, clients, applications, and append-only audit events
- Server-only HealthSherpa quote gateway with strict input validation
- App Service health endpoint at `/api/health`
- Standalone Next.js build for Azure App Service

## Configuration

Copy `.env.example` to `.env.local` for local development. Never commit real credentials.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `HEALTHSHERPA_API_KEY` | HealthSherpa credential; configured as an App Service Key Vault reference |
| `HEALTHSHERPA_API_BASE_URL` | Approved HealthSherpa ONE origin; staging example in `.env.example` |
| `HEALTHSHERPA_WORKFLOW_ENABLED` | Default false; isolated testing/reconciliation release gate |
| `HEALTHSHERPA_ENROLLMENT_SESSIONS_ENABLED` | Default false; provider approval and linked OAuth required |
| `HEALTHSHERPA_AGENT_EXTERNAL_ID` | Exact Entra identity linked to the configured HealthSherpa key |
| `DEMO_AUTH` | Set to `true` only for local development without App Service Authentication |

Apply `database/001_initial.sql` to the target PostgreSQL database before using the API routes.

## Intake storage and access

After the initial schema, apply `database/002_intake.sql` to an **isolated test database first**. This additive migration stores partial household intakes alongside their leads; it does not alter existing clients or applications. No migration runs automatically on startup.

- Agents can create leads and save/resume only their own intakes. Administrators can access all leads and intakes. Viewers can read their own lead summaries and cannot create or edit records or open household intake details.
- Both draft saving and submission require applicant consent. The database records the original consent timestamp and agent identity. Each successful save writes an audit event without applicant details.
- Drafts may omit applicant fields. Submission requires the complete form and changes intake status to `ready_for_quote`. Submitted intakes are read-only. This step does not request a quote, submit an enrollment, or create a client/application record.
- Saves update a single lead and intake transactionally. Versions reject stale updates; a stable lead ID prevents duplicate first-save retries. If a save response is lost, use the saved-intake link or Leads to recover the record before retrying edits.
- The dashboard counts all accessible leads. Leads shows the latest 100 accessible records, with search and stage filters applied to that set. Storage failures show errors rather than sample records.

The app trusts Azure App Service Authentication headers. Production must require Entra authentication, restrict accepted tenants/audiences and app-role assignments, and prevent any path to the app that bypasses App Service Authentication. Identity handling follows [Microsoft's App Service identity documentation](https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-user-identities). `agency_users.active` is not an additional authorization source; revoke access in Entra. Records previously written with the legacy `unknown` owner require an explicit administrator-reviewed ownership migration; they are never exposed to ordinary agents by default.

For authorized Azure testing, configure a separate PostgreSQL database and apply both migrations there, then test with separate Entra admin, agent, and viewer accounts and fictional households. Check agent isolation, draft resumption, consent/audit records, submission, and storage failure behavior before considering production. No production database, enrollment credential, or HealthSherpa request is required for the tests below. This integration does not connect or replace the separate open enrollment dashboard.

Branch pushes run validation and package the app; they do not deploy it. The existing Azure deployment job now requires a manual workflow dispatch with `deploy_to_azure` explicitly enabled. Do not enable it until the target app/database and authorized test plan are confirmed. No Azure settings or credentials are modified by this change.

## Local verification

```bash
npm ci
DEMO_AUTH=true npm run dev
npm run lint
npm test
npm run build
```

Browser verification uses an ephemeral PostgreSQL-compatible PGlite database over a loopback-only wire server. It overrides the database URL, disables demo authentication and clears HealthSherpa credentials in the test child process. Identity headers are fictional fixtures for the local test server, not a substitute for authorized Entra testing on Azure.

```bash
npx playwright install chromium
npm run test:e2e
```

Alternatively set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome browser. The test server uses ports 3107 and 55439 and discards its in-memory records when it exits.

Validation uses Node 24. The framework is patched to Next.js 16.3.8. At implementation time `npm audit --omit=dev` reported no production vulnerabilities; full audit still reports five high-severity findings in the development-only `eslint-config-next` → `fast-glob` → `micromatch` → `braces` chain. The suggested automated fix downgrades the framework lint configuration to version 14, so it was not applied.

## Azure App Service

Use Node 24 (or the current supported LTS), set the startup command to `npm run start`, and configure the health check path as `/api/health`. App Service Authentication should require Microsoft Entra ID authentication and pass the `X-MS-CLIENT-PRINCIPAL` header to the application.

The application reads `HEALTHSHERPA_API_KEY` only in the Node.js server runtime. Do not rename it with a `NEXT_PUBLIC_` prefix.

## Unified ACA workflow (review branch)

See [ENROLLMENT_WORKFLOW.md](ENROLLMENT_WORKFLOW.md) for record authority, Base44/Hub/Azure field and permission mapping, duplicate risks, and the staged release plan. Migration `003_enrollment_workflow.sql` is additive and must be applied only to an isolated database first.

The saved-intake page now provides county lookup, documented assistance consent, explicit applicant quote inputs, admin-reviewed legacy record links, and a guarded HealthSherpa agent handoff. API keys remain server-side. A handoff is not an application submission; final Marketplace work takes place in HealthSherpa. Neither feature gate is enabled by this code change. No automatic imports, Hub sync, policy-status polling or production migration is included.

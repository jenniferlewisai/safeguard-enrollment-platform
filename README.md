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
| `HEALTHSHERPA_API_BASE_URL` | Approved HealthSherpa API base URL |
| `DEMO_AUTH` | Set to `true` only for local development without App Service Authentication |

Apply `database/001_initial.sql` to the target PostgreSQL database before using the API routes.

## Local verification

```bash
npm ci
DEMO_AUTH=true npm run dev
npm run lint
npm run build
```

## Azure App Service

Use Node 24 (or the current supported LTS), set the startup command to `npm run start`, and configure the health check path as `/api/health`. App Service Authentication should require Microsoft Entra ID authentication and pass the `X-MS-CLIENT-PRINCIPAL` header to the application.

The application reads `HEALTHSHERPA_API_KEY` only in the Node.js server runtime. Do not rename it with a `NEXT_PUBLIC_` prefix.

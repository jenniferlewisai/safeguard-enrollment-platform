BEGIN;
-- Additive only. No backfill, deduplication, ownership changes, or automatic execution.
CREATE TABLE enrollment_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL UNIQUE REFERENCES leads(id),
  coverage_year integer NOT NULL CHECK (coverage_year BETWEEN 2020 AND 2099),
  hub_office_id uuid,
  hub_client_id uuid,
  base44_enrollment_id text UNIQUE,
  linked_by text,
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((hub_office_id IS NULL) = (hub_client_id IS NULL)),
  UNIQUE (hub_client_id, coverage_year)
);
CREATE TABLE enrollment_consent_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES enrollment_cases(id),
  status text NOT NULL CHECK (status IN ('granted','revoked')),
  scope text NOT NULL DEFAULT 'marketplace_assistance' CHECK (scope = 'marketplace_assistance'),
  evidence_reference text NOT NULL CHECK (length(trim(evidence_reference)) BETWEEN 3 AND 300),
  actor_external_id text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX enrollment_consent_latest_idx ON enrollment_consent_events(case_id,id DESC);
CREATE TABLE healthsherpa_handoffs (
  case_id uuid PRIMARY KEY REFERENCES enrollment_cases(id),
  idempotency_key uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  consent_event_id bigint NOT NULL REFERENCES enrollment_consent_events(id),
  actor_external_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','succeeded','review_required')),
  shopping_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'succeeded' OR shopping_url IS NOT NULL)
);
-- These are server-only tables, not a public cross-application data API.
REVOKE ALL ON enrollment_cases,enrollment_consent_events,healthsherpa_handoffs FROM PUBLIC;
COMMIT;

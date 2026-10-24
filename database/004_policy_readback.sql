BEGIN;
-- Minimal latest provider observation; never rewrites lead or enrollment stages.
CREATE TABLE healthsherpa_policy_snapshots (
  case_id uuid PRIMARY KEY REFERENCES enrollment_cases(id),
  consent_event_id bigint NOT NULL REFERENCES enrollment_consent_events(id),
  policies jsonb NOT NULL CHECK (jsonb_typeof(policies)='array'),
  checked_at timestamptz NOT NULL DEFAULT now(),
  checked_by text NOT NULL
);
REVOKE ALL ON healthsherpa_policy_snapshots FROM PUBLIC;
COMMIT;

BEGIN;
-- Additive: existing leads and application records are unchanged.
CREATE TABLE lead_intakes (
  lead_id uuid PRIMARY KEY REFERENCES leads(id),
  status application_status NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready_for_quote')),
  data jsonb NOT NULL,
  consent_captured_at timestamptz NOT NULL DEFAULT now(),
  consent_captured_by text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;

-- Let the outbox carry registration_status events: a sign-up sent earlier that
-- no longer counts. Only the allowed kinds change; existing rows stay valid.
ALTER TABLE marketing_conversions DROP CONSTRAINT marketing_conversions_kind_check;
ALTER TABLE marketing_conversions ADD CONSTRAINT marketing_conversions_kind_check
  CHECK (kind IN ('registration', 'purchase', 'refund', 'visit', 'conversion_context', 'registration_status'));

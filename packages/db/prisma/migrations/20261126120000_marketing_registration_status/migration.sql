-- A separate kind keeps voids out of counts of captured registrations.
ALTER TABLE marketing_conversions DROP CONSTRAINT marketing_conversions_kind_check;
ALTER TABLE marketing_conversions ADD CONSTRAINT marketing_conversions_kind_check
  CHECK (kind IN ('registration', 'purchase', 'refund', 'visit', 'conversion_context', 'registration_status'));

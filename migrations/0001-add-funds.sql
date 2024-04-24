ALTER TABLE bonds ADD COLUMN funded_amount NUMERIC DEFAULT 0;
ALTER TABLE bonds ADD COLUMN effective_amount NUMERIC DEFAULT 0;
ALTER TABLE bonds ADD COLUMN remaining_witdraw_request_amount NUMERIC DEFAULT 0;
ALTER TABLE bonds ADD COLUMN remainining_settlement_claim_amount NUMERIC DEFAULT 0;

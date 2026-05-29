-- DEPRECATION NOTE: the `cli_usage` table is no longer written.
-- The `/v1/cli-usage` endpoint has been removed and CLI telemetry now
-- ships to Mixpanel via the company-wide mix-proxy.
-- Historical data is retained; no new rows are inserted.
COMMENT ON TABLE cli_usage IS 'DEPRECATED: no longer written; CLI telemetry moved to Mixpanel.';

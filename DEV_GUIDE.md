# validator-bonds — Dev Guide

Internal dev/ops notes. For validator-facing docs see the
[CLI README](./packages/validator-bonds-cli/README.md).

## Publishing a CLI announcement banner

CLI banners come from broadcast notifications in
[marinade-notifications](https://github.com/marinade-finance/marinade-notifications),
not this repo — publish one with a POST to `/bonds-event-v1`.

### How to post

Obtain a JWT per the
[notification-service DEV_GUIDE](https://github.com/marinade-finance/marinade-notifications/blob/main/notification-service/DEV_GUIDE.md)
(your `sub` must be in `ALLOWED_USERS`), then:

```bash
NOTIFICATIONS_API_URL=https://marinade-notifications.marinade.finance
JWT_TOKEN=<paste>

PAYLOAD=$(jq -n \
  --arg title "Scheduled maintenance on 2026-04-05" \
  --arg message $'CLI will be briefly unavailable 14:00–15:00 UTC.\nRetry your command afterwards.' \
  --arg message_id "$(uuidgen)" \
  --argjson created_at_ms "$(date +%s%3N)" \
  --arg created_at_iso "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" \
  '{
    header: {
      producer_id: "ops-manual",
      message_id: $message_id,
      created_at: $created_at_ms
    },
    payload: {
      type: "bonds",
      inner_type: "announcement",
      vote_account: "11111111111111111111111111111111",
      bond_pubkey: null,
      bond_type: "bidding",
      epoch: 800,
      data: { title: $title, message: $message, details: {} },
      created_at: $created_at_iso
    }
  }')

echo "$PAYLOAD" | jq .   # sanity-check before sending

curl -X POST "$NOTIFICATIONS_API_URL/bonds-event-v1" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $JWT_TOKEN" \
  -d "$PAYLOAD"
```

Tips:

- Use `jq -n` and `$'...\n...'`. Inline JSON in `curl -d '...'` with `\n`
  breaks easily (`Bad control character in string literal`).
- Banner text is plain — no markdown. Inline URLs after the anchor text
  (e.g. `Find out details↗ https://...`).
- Verify locally by pointing the CLI at a local or staging service:
  `NOTIFICATIONS_API_URL=http://localhost:3000 pnpm cli -u mainnet show-config <pubkey>`.

### Timing and disabling

Defaults from
[`notifications-bonds/src/config/thresholds.yaml`](https://github.com/marinade-finance/marinade-notifications/blob/main/notifications-bonds/src/config/thresholds.yaml):
`force_broadcast: true` (fans out to **all** `sam_auction` subscribers),
`priority: critical`, `relevance_hours: 336` (auto-expires after 14 days,
filtered server-side), `skip_dedup: true`.

No retraction endpoint — to kill an announcement early, connect to the
marinade-notifications Postgres:

```sql
UPDATE notifications_outbox SET deactivated_at = now()
WHERE inner_type = 'announcement' AND id = <id>;
```

### Context

- The CLI calls `listBroadcastNotifications` on every command and renders
  each result as a boxed banner. Public CLI subscribes to
  `notification_type: sam_auction`; institutional CLI to
  `institutional_select`.
- `/bonds-event-v1` routes announcements to `sam_auction` only — **the
  institutional CLI will not see them** until a producer is wired.
- `payload.vote_account` is required by schema but ignored under
  `force_broadcast: true`; any valid base58 works.
- `payload.data.details` is free-form and currently unread by the banner.
- Source:
  [`notifications.ts`](./packages/validator-bonds-cli-core/src/notifications.ts) (fetch),
  [`banner.ts`](./packages/validator-bonds-cli-core/src/banner.ts) (render).

## CLI usage telemetry

CLI invocations emit Mixpanel events via the shared
[`mix-proxy.marinade.finance`](https://github.com/marinade-finance/ops-infra/blob/main/argocd/mixpanel-proxy/mixpanel-proxy.yaml)
pass-through. Implementation in
[`packages/validator-bonds-cli-core/src/cliUsage.ts`](./packages/validator-bonds-cli-core/src/cliUsage.ts).

### Publishing

The Mixpanel project token is baked into the published `dist/` of
`@marinade.finance/validator-bonds-cli-core` by
[`scripts/inject-mixpanel-token.js`](./scripts/inject-mixpanel-token.js),
invoked from cli-core's `prepublishOnly` hook. The publish step **fails if
`MIXPANEL_TOKEN` is unset**, so production CLIs always carry a valid token:

```bash
MIXPANEL_TOKEN=<project-token> pnpm publish:cli
```

Local builds (and ts-node runs from source) carry a placeholder that the
runtime treats as "telemetry disabled", so dev work doesn't land in the
production project.

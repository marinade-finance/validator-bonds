# Validator Bonds Notifications

> **Testing Phase Notice**: The notification system is currently in testing.
> The notification content, frequency, and thresholds are being evaluated and will be enhanced over time
> based on validator feedback.
> Email notifications are configurable but not yet fully implemented — email delivery will be available soon.

## How Notifications Work

The notification system monitors the state of your validator bond and alerts you
when something important changes. The processing pipeline works as follows:

1. **State monitoring** — The system periodically checks the state of all bonds
   participating in the SAM Auction (bond balance, auction status, eligibility, etc.).
2. **Change detection** — When a relevant change is detected for your bond
   (e.g., your bond becomes underfunded, you exit the auction), an event is generated.
3. **Notification delivery** — The event is evaluated, prioritized, and delivered
   to you via your subscribed channel (Telegram, or the CLI notifications view).

You only receive notifications when something **changes** — the system does not
repeatedly alert you about a persistent condition.

## What Notifications Will You Receive?

Notification types:

- **Bond underfunded** — bond balance changed relative to auction costs
- **Auction exited / entered** — your validator left or joined the SAM Auction
- **Cap constraint changed** — binding stake allocation constraint changed
- **Bond removed** — bond no longer visible in auction data
- **Bond balance changed** — SOL balance on your bond account changed
- **SAM eligibility changed** — validator SAM eligibility toggled
- **Announcements** — broadcast messages from Marinade to all validators

> **Note:** We are currently in beta. Thresholds, priority levels, and notification frequency
> may change during testing. We welcome your feedback.

## Subscribing to Notifications

### Requirements

- The `validator-bonds` CLI
- Your **bond authority keypair** or **validator identity keypair**
  (file-based keypair or Ledger hardware wallet)

### Subscribe via Telegram

To subscribe your bond to Telegram notifications:

```bash
validator-bonds subscribe <BOND_OR_VOTE_ACCOUNT> \
  --type telegram \
  --address @YourTelegramHandle \
  --authority /path/to/authority-keypair.json
```

**Subscription flow:**

```
 CLI subscribe          Server                Telegram
 ──────────────         ──────                ────────
       │                   │                      │
  sign with keypair        │                      │
       │───── request ────>│                      │
       │<── deep link ─────│                      │
       │                   │                      │
  browser opens ──────────────── click "Start" ──>│
                           │<─── activated ───────│
                           │                      │
                      notifications ─────────────>│  (delivered)
```

- The CLI signs an off-chain message with your authority keypair to prove bond ownership.
- Your browser opens a Telegram deep link — press **"Start"** in the bot to activate.
- Notifications are **not delivered** until you confirm in Telegram.
- If the browser does not open, copy the link from the CLI output manually.

> **Important**: The Telegram activation (deep link + Start) is required **every time**
> you subscribe or re-subscribe, even for the same bond. Always go through the CLI first.

### Subscribe via Email

```bash
validator-bonds subscribe <BOND_OR_VOTE_ACCOUNT> \
  --type email \
  --address your@email.com \
  --authority /path/to/authority-keypair.json
```

> **Coming soon**: Email delivery is configurable but not yet fully operational.
> The subscription will be recorded and you will start receiving email notifications
> once the feature is fully rolled out.

### Subscription Scope

Currently, a subscription covers **all notification types** for the given bond.
Granular subscription modes (e.g., subscribing only to critical alerts or only to
specific event types) are **not available** at this time. This may be added in the future.

## Viewing Your Subscriptions

To see your active subscriptions for a bond:

```bash
validator-bonds subscriptions <BOND_OR_VOTE_ACCOUNT> \
  --authority /path/to/authority-keypair.json
```

You can use `-f json` or `-f yaml` for machine-readable output.

## Unsubscribing

### Unsubscribe a specific channel address

```bash
validator-bonds unsubscribe <BOND_OR_VOTE_ACCOUNT> \
  --type telegram \
  --address @YourTelegramHandle \
  --authority /path/to/authority-keypair.json
```

### Unsubscribe all subscriptions of a given type

Omitting `--address` removes **all** subscriptions of the specified type:

```bash
validator-bonds unsubscribe <BOND_OR_VOTE_ACCOUNT> \
  --type telegram \
  --authority /path/to/authority-keypair.json
```

> **Note**: Unsubscribing also requires signing with the bond authority or validator
> identity keypair, the same as subscribing.


### View notifications for your bond

```bash
validator-bonds show-notifications <BOND_OR_VOTE_ACCOUNT>
```

## Quick Reference

| Action | Command |
|--------|---------|
| Subscribe (Telegram) | `validator-bonds subscribe <BOND> --type telegram --address @handle --authority keypair.json` |
| Subscribe (Email) | `validator-bonds subscribe <BOND> --type email --address you@email.com --authority keypair.json` |
| List subscriptions | `validator-bonds subscriptions <BOND> --authority keypair.json` |
| Unsubscribe specific | `validator-bonds unsubscribe <BOND> --type telegram --address @handle --authority keypair.json` |
| Unsubscribe all of type | `validator-bonds unsubscribe <BOND> --type telegram --authority keypair.json` |
| View notifications | `validator-bonds show-notifications <BOND>` |
| View announcements | `validator-bonds show-notifications` |

`<BOND>` can be either a **bond account address** or a **vote account address**.

## Ledger Hardware Wallet Support

All subscribe/unsubscribe commands support Ledger hardware wallets.
Pass your Ledger as the `--authority` option and the CLI will prompt you
to confirm the off-chain message signing on the device.

## Feedback

This notification system is under active development. If you have feedback
on notification content, frequency, missing events, or the subscription
experience, please reach out to the Marinade team.

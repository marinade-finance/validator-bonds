# Code Review

Context:

- Reviewed `git diff main` in `/home/chalda/marinade/validator-bonds`
- Cross-checked design intent in `SUMMARY.md` and `IMPLEMENTATION_PLAN.md`
- Read related subscription and consumer code in `/home/chalda/marinade/marinade-notifications`

## Findings

### 1. `subscriptions` can resolve the wrong bond on read

Severity: High

The CLI resolves the requested bond or vote account locally, but the `subscriptions` command does not send any bond-specific identifiers to the server. It only sends the signer's `pubkey`.

Files:

- `/home/chalda/marinade/validator-bonds/packages/validator-bonds-cli-core/src/commands/manage/subscriptions.ts`
- `/home/chalda/marinade/marinade-notifications/notification-service/subscriptions/bonds-subscription-verifier.ts`
- `/home/chalda/marinade/marinade-notifications/notification-service/subscriptions/subscriptions.controller.ts`

Why this matters:

- For bond authorities that control more than one bond, the server-side reverse lookup returns only the first matching bond.
- The response can therefore show subscriptions for a different bond than the one the CLI user explicitly asked about.
- The server reverse lookup is also hardcoded to the default Marinade config address, so this path is not robust for other bond configs.

Evidence:

- The CLI fetches the requested bond and vote account, but then calls `listSubscriptions()` with only:
  - `pubkey`
  - `notification_type: 'bonds'`
- The server-side `GET /subscriptions` path authenticates by reverse lookup and resolves `userIds` from the signer pubkey rather than from the requested bond context.
- `checkAsBondAuthority()` returns the first matching bond account and maps it to a single `voteAccount`.

Risk:

- Incorrect data exposure within the validator's own authority scope.
- Operational confusion: the CLI output can claim "subscriptions for vote account X" while actually returning records for Y.

Recommendation:

- Make the read path bond-specific, the same way subscribe/unsubscribe already are.
- Send `config_address`, `vote_account`, and `bond_pubkey` for reads too, or add a dedicated endpoint keyed by vote account / bond.
- Do not rely on reverse lookup when the CLI already knows exactly which bond the user requested.

### 2. Underfunding events are suppressed before the notification brain can evaluate significance

Severity: Medium

The event producer emits `bond_underfunded_change` only when `bondGoodForNEpochs` changes after rounding to 2 decimals.

Files:

- `/home/chalda/marinade/validator-bonds/packages/bonds-eventing/src/evaluate-deltas.ts`
- `/home/chalda/marinade/validator-bonds/packages/bonds-notification/src/evaluate.ts`

Why this matters:

- The notification brain was designed to decide significance using:
  - `min_deficit_sol`
  - `significant_change_pct`
  - priority rules over current coverage
- But the producer filters events first on rounded epoch coverage.
- A materially important deficit change can happen without changing rounded coverage, especially on large stake sizes.

Example failure mode:

- Previous coverage: `1.234`
- Current coverage: `1.238`
- Both round to `1.23`, so no event is emitted.
- If the deficit or required top-up changed meaningfully in SOL terms, the brain never sees it.

Risk:

- Missed or delayed warning notifications.
- Behavior diverges from the documented architecture, where eventing should emit deltas and the brain should decide what is significant enough to notify.

Recommendation:

- Emit the underfunded event when deficit-related inputs change materially, not only when rounded `bondGoodForNEpochs` changes.
- At minimum, compare an additional lamport or SOL-based deficit measure in the eventing layer.

### 3. Producer audit records use a different `message_id` than the actual emitted message

Severity: Medium

The event producer sends one `message_id` to `marinade-notifications`, but stores a different random UUID in `emitted_bond_events`.

Files:

- `/home/chalda/marinade/validator-bonds/packages/bonds-eventing/src/emit-events.ts`
- `/home/chalda/marinade/validator-bonds/packages/bonds-eventing/src/persist-events.ts`

Why this matters:

- The DB audit trail cannot be correlated directly with:
  - ingress logs
  - queue rows
  - consumer logs
  - DLQ/archive records
- This weakens debugging, replay analysis, and incident response.

Evidence:

- `postEvent()` creates an envelope `header.message_id`.
- `persistEvents()` inserts a fresh `crypto.randomUUID()` instead of the sent one.

Risk:

- Lost observability and weaker forensic traceability.

Recommendation:

- Generate the message ID once per event before send.
- Reuse the same ID in the HTTP envelope and in `emitted_bond_events`.

## Verification

Checked locally:

- `pnpm --filter @marinade.finance/bonds-notification test`
- `pnpm --filter @marinade.finance/bonds-eventing build`
- `pnpm --filter @marinade.finance/bonds-notification build`

Not fully verified:

- `pnpm --filter @marinade.finance/bonds-eventing test`
  - The HTTP-based tests were blocked in the sandbox with `listen EPERM`, so I used static review for the producer HTTP/persistence path.

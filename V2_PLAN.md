- do POST event burst with an array of events to not pushing one by one (from eventing to accept on GET on marinade notification side)
- do some clearing of the old emitted events in validator bonds eventing. it's like 100K events per week. its a number we could consider to remove like older than 1 month or similar (investigate)
- consider to do call on every send to verify if it has been blocked or unblocked. That should be like having to set once a day from blocked to pending and only once per day to find if those that are pending are still blocked. Need to verify if cancelled subscription will be announced with another error code to know that cancelled subscrption cannot be always moved from blocked->pending (or similar) as that won't be never activated from tlg.
- not forcing to run deep link in case we have activated subscription for a user on telegram. it should be enough to just subscribe the tlg link to another bond id
  The answer is: yes, each subscription needs its own deep link click. Here's why
  The telegram-bot has its own subscriptions table with unique constraint on (chat_id, feature, external_id). When the notification-service calls POST /send with a feature + external_id, the bot looks up
  SELECT \* FROM subscriptions
  WHERE feature = 'feature_sam_auction
  AND external_id = '<uuid>'
  AND last_unsubscribed_at IS NULL
  Each external_id from the notification-service maps to exactly one row in the bot's DB. If there's no row for that external_id, the bot returns 404 (never existed) or 410 (unsubscribed).
  So the flow per subscription is:
  1. POST /subscriptions on notification-service → creates row with new external_id, telegram_status=pending
  2. User clicks https://t.me/mnde_test_bot?start=feature_sam_auction-<external_id> → bot creates its own subscription row linking chat_id ↔ external_id
  3. Now POST /send with that external_id resolves to the correct chat_id
     Subscribing a second vote_account creates a new external_id in the notification-service. The bot doesn't know about it until you click that new deep link. There's no mechanism to auto-activate all subscriptions for the same chat_id — the bot enforces a 1:1
     mapping between external_id and the telegram chat.
- add a smoke test

- When a user unsubscribes via the Telegram bot UI or blocks the bot, the
  notification service marks the subscription as `unsubscribed` or `blocked` and
  stops delivery. Clicking the original Telegram deep link again reactivates the
  subscription on the telegram-bot side, but the notification service is not
  notified — it still sees the old status and skips delivery.
  see https://github.com/marinade-finance/marinade-notifications/pull/27#discussion_r3000772030
  \*\* An idea to fix
  Here's a simpler idea: don't skip blocked/unsubscribed — only skip inactive (404).
  The rationale: - inactive (404) = subscription never existed in telegram-bot (bad external_id). Genuinely broken, no point retrying. - blocked/unsubscribed = user may reactivate by clicking the deep link again. These are recoverable states.

        If you always call /send for blocked/unsubscribed subscriptions, telegram-bot will:
        - Return 200 if the user reactivated → status goes back to active
        - Return 410 if still blocked → status stays, you move on quickly
        The cost is one HTTP call per blocked subscription per notification event. With a small subscriber base in v1, this is negligible. telegram-bot checks its own DB and returns fast — it doesn't hit the Telegram API for inactive users.
        This requires:
        1. Change the delivery filter to only skip inactive, not blocked/unsubscribed
        2. No new endpoints, no webhooks, no architectural changes
        The only downside is if you accumulate thousands of permanently-blocked subscriptions over time, you'd be making pointless HTTP calls. You could mitigate that later with a TTL (e.g., stop retrying blocked after 30 days) — but that's a v2
        concern.
        Does this approach work for you?

  \*\* Telegram deep links (https://t.me/BotName?start=payload) don't expire. They're just a URL that triggers the bot's /start command with the payload parameter. There's no TTL or invalidation on Telegram's side
  The link works as long as
  1. The bot exists and is running
  2. The bot's code handles that
     So the deep link is valid for reactivation indefinitely — which actually supports the "don't skip blocked/unsubscribed" approach. A user can always click their original link to reactivate, and the next /send call will discover it worked.

- Admin access for subscribe/unsubscribe is not much elegant.
  Maybe there is a better way - investigate.
- notification_dedup table grows unbounded — no retention policy or cleanup job                                                                                                                                                                                      notifications_outbox also has no cleanup — expired rows accumulate forever 
- Rate limiting email delivery for broadcasts                 
  The current sequential processing in the consumer is fine for v1. An announcement broadcast to all subscribers processes one-by-one through SmtpService.send() which already has retry with backoff.
  The risk scenario: 500 email subscribers × broadcast announcement. At ~200ms per SMTP send, that's ~100 seconds — well within the consumer's processing lease (5 minutes, CONSUMER_PROCESSING_LEASE_MS). Mailgun's rate limit is typically 300 messages/minute on
  standard plans, so sequential sending naturally stays under                                                               
  If this becomes a problem, the fix would be batching (process N emails per dequeue cycle) — but I'd wait for a real signal rather than build it now.


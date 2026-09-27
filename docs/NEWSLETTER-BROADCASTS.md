# Newsletter Broadcast delivery

The owner composes and previews a newsletter in the existing admin section. Sending requires the branded confirmation dialog. Queueing snapshots the message, shop footer settings, and configured TLB Newsletter segment/topic into one private Broadcast job. No per-subscriber transactional campaign emails are created.

The existing email worker completes order messages first, then handles one Broadcast job. It creates a Resend draft with `send:false`, the configured `segment_id` and `topic_id`, and `{{{RESEND_UNSUBSCRIBE_URL}}}` in HTML and plain text. It persists the provider ID before sending and verifies the returned audience/topic. Resend applies segment membership, topic preferences and global unsubscribe suppression. A pending local unsubscribe defers sending until preference synchronization finishes.

The worker records send intent before calling `/broadcasts/{id}/send`. After an ambiguous network response it retrieves the same Broadcast ID, rather than creating another campaign or blindly sending again. An uncertain draft, changed audience, or repeated provider failure becomes **Needs review**. Review that saved Broadcast in Resend before any manual send. An interrupted draft creation can leave an unsent orphan draft; it cannot create a second sent campaign. Accepted/queued status means provider acceptance, not inbox delivery. Subsequent worker runs reconcile sent/canceled status; recipient delivery analytics remain in Resend.

Order notifications, personal welcome-code emails and owner-only preview tests remain individual transactional emails. Newsletter campaigns cannot fall back to `/emails`; legacy campaign outbox rows are stopped for review. Existing subscription synchronization, unrelated segments, global opt-outs, and already-issued welcome codes are unchanged.

Deployment: apply `20260927094000_newsletter_broadcast_delivery.sql`, deploy `email-worker` with its relative shared/template dependencies, and publish the admin assets. Keep the existing custom `EMAIL_WORKER_TOKEN` authorization (`verify_jwt=false`). `NEWSLETTER_RESEND_API_KEY` must permit Broadcasts; `NEWSLETTER_FROM` must use a verified sender. Existing order-key/sender fallback remains supported. No new credentials belong in browser code.

Tests: backend suite includes owner/service authorization, confirmation, immutable snapshots, exclusive leases, no transactional fan-out, opt-out deferral, durable provider IDs and retry fencing. Edge tests mock Resend, including audience mismatch and ambiguous send recovery. UI tests cover desktop/mobile composition and final-send confirmation. These tests send no live emails.

API references: https://resend.com/docs/api-reference/broadcasts/create-broadcast and https://resend.com/docs/api-reference/broadcasts/send-broadcast. The current Resend OpenAPI schema documents `topic_id` on Broadcasts.

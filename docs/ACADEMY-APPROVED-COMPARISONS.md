# Approved Academy comparisons

The 30 visual comparisons approved on 2 October 2026 cover 42 findings from the complete experience audit. This implementation also adds the requested owner control for the picture shown before login. The five technical repairs already identified by the audit are included. The earlier audit's BEFORE images remain unchanged; the implementation review uses actual application screenshots with synthetic accounts and content.

## Student experience

- The welcome screen, dashboard, class cards, module cards, recipe pages, gallery, sharing form, conversations, announcements, and workshop inquiry handoff follow the approved layouts. Portrait tablets use the compact navigation and wider recipe workspace.
- Recipe quantities, ingredient qualifiers, preparation stages, equipment, and method text are preserved. Phone section controls keep Ingredients and Method reachable. Timing and temperature remain beside their steps.
- Unsent questions, creations, and replies retain their text and selected photos for 30 minutes while navigating Academy in the same tab. They clear on send or account change. Reloading or closing the tab does not preserve them.
- Failed photo uploads retry the same reservation. Lost draft-creation responses can recover the original request or cancel it before editing. Successful sends do not create duplicates.
- Private sharing explains its audience. Original-photo fallback remains private and keeps its existing metadata warning. Public welcome pictures always require prepared, metadata-free WebP output.

## Owner and instructor experience

- Accounts have complete paged search, select-visible controls, retained selections, multi-class assignment, and refreshed enrollment counts. Assignment never opts an account into newsletters.
- Class editing has an outline for module and recipe order, visibility, placement, and removal. A hidden module or recipe is also blocked by server reads. Removing a placement preserves historical student work.
- Teaching recipes show their source and shared class usage, support independent duplication, and can be assigned after saving. Photo controls show saved pictures, cover choice, order, and removal. Removal retires the reference; it does not physically delete a Storage object.
- Admin editors show unsaved state, keep actions reachable, and guard navigation. Moderation has search, filters, pagination, compact review, select-visible actions, confirmations, and a 15-minute Undo that refuses to overwrite a later change.
- Email review lists matched recipients and exclusions. Searchable account chips supplement typed email addresses. Consent, verified-email requirements, and the existing delivery-time checks still apply. Sending a reviewed audience rejects a changed recipient set.
- The instructor inbox shows conversations needing a reply, pending gallery posts, and unseen private submissions. Private feedback opens or reuses a class-scoped conversation with the submitting student.

## Change the logged-out picture

Open **Academy Admin → Academy appearance**. Choose a landscape image, enter an image description, inspect the preview, and choose **Save picture**. **Cancel changes** discards the local selection. **Use default picture**, then **Save picture**, restores the supplied TLB image.

The selected picture is public. It is stored in the separate `academy-welcome` bucket; protected student photos and class materials retain their existing private buckets and access checks. Only the owner can reserve a welcome image or save its configuration. Anonymous visitors receive only the image path, description, and configuration revision. A stale editor cannot overwrite a newer configuration, and retrying a lost save response applies the change once.

## Validation and rollout

Run `npm run test:academy:comparisons` for the new database, Edge, photo-helper, welcome, student, and admin checks. Run `npm run test:academy:repairs` for the five original technical repairs. Existing Academy backend, recovery, approved re-audit, and original-photo suites provide regression coverage. Browser tests use the real application and isolated PostgreSQL/RLS with synthetic actors; authentication and upload transport are fixtures.

The implementation was integrated with main through PR #142, including the shared website header. Final visual evidence is produced after that integration. Native cameras, native mobile keyboards, real email delivery, and production user journeys require live acceptance after deployment.

Deployment is a separate operation from the approved implementation and review branch:

1. Review the database migration `20261002145605_academy_approved_comparison_management.sql` and any previously pending migrations in order. The previous visual-email backend rollout remains a separate pending item.
2. Deploy the backward-compatible `academy-media` Edge function, which recognizes the validated welcome bucket as well as the private media bucket.
3. Apply the reviewed migration sequence. The comparison migration requires its existing function hooks and aborts if those hooks differ.
4. Publish the frontend, then verify owner picture editing and anonymous display, class visibility, student photo retry, instructor feedback, and recipient review against production.

The migration adds private management tables with RLS and no direct browser grants. It does not move private photos into a public bucket or delete existing files. Rolling the frontend back leaves the additive data intact; do not remove new database records as a rollback shortcut.

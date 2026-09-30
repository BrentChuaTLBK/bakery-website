# Recipe purchases, suppliers and account access — 30 September 2026

## Behavior

**Record purchase** collects an ingredient or packaging item, brand, supplier,
price, purchase quantity/unit, date and notes in one dialog. Saving atomically
creates missing records or reuses existing matches. A request ID prevents a
retried save from duplicating prices. Purchase pricing is recorded for costing;
inventory receipts and accounting expenses are not automatically posted.

Each ingredient/packaging item can retain alternative suppliers and their price
history. Costing selects the lowest comparable unit cost from each supplier's
latest quote, unless a preferred supplier is chosen. Saved production formulas
and their historical costs remain unchanged. Incompatible/missing prices remain
explicitly incomplete. Packaging supports private photos, captions and a supplier
without requiring a price. Form sections have clearer spacing.

Owners can invite an email as Chef or Kitchen. Invitations use the existing
transactional outbox; verification and a matching email are required. Access is
independent of shop staff privileges. Only owners can manage access or approve
production recipes. Revoked/expired invitations cannot be claimed, and the mail
gateway rechecks invitation state before sending. The backup includes invitation
records and packaging files without granting shop roles during restoration.

## Bugs fixed

- A cached older client module lacked the recipe API export, leaving the page on
  “Opening your recipe library.” Versioned imports, a guarded loader, a timeout
  and persistent recovery controls now cover module/auth startup failures.
- GitHub Pages' Jekyll processing excluded required underscore-prefixed hashing
  modules. `.nojekyll` is included in both source and the static build.
- Recipe-only account navigation now reuses the existing authenticated session
  rather than creating a second Auth client. It works independently of shop
  dashboard authorization.
- Supplier selection previously depended on adding a price. Supplier links and
  price history are now separate; price history opens without discarding edits.
- Restoring access previously could create shop staff accounts for recipe-only
  users. Restoration now preserves the original scope of access.
- A live archive rehearsal revealed a false mismatch between UTC and Manila
  timestamps. The verifier compares both sides using the database column types,
  preserving microseconds and leaving nested recipe JSON untouched.

## Data and deployment

Migration `20260930060825_recipe_account_access.sql` adds private invitations,
recipe-only Auth relationships, atomic purchase recording, supplier cost
selection and mail/backup support. Price history and audit records remain
immutable. A partial unique audit index enforces purchase retry safety.

The migration is deployed to TLB production (provider migration version
`20260930064959`). Reconcile that applied version with the source filename before
using CLI migration replay; do not execute this migration twice. `email-worker` v30 and
`recipe-backup` v2 are active with their existing custom authentication.
The browser changes are on `codex/recipe-startup-fix`; merging the upstream
follow-up is still required to publish them.

The owner-authorized Suppliers/Packaging workbook import created 77 supplier
labels, 187 ingredient records, 68 packaging records, 333 supplier links and
340 prices. All 361 source rows are retained in private source notes/data.
Twenty-two rows require review for missing units/prices, textual freight charges,
date issues or conflicting values; uncertain costs were excluded rather than
guessed. The conflicting Christmas Tree Kraft Box price remains blank pending
the owner's answer. Existing supplier labels were only normalized for case and
spacing. Formula calculation blocks were excluded; no component recipes were
created from them. The original workbook was unchanged. Private workbook data,
supplier contacts and import SQL are excluded from this public source change.

## Verification

- Eight production database checks passed inside a rolled-back transaction:
  verified/pending/revoked access, no staff privilege leakage, atomic purchase
  reuse/retries, lowest/preferred costs, historical snapshots, packaging validation
  and unauthorized purchase rejection. No test accounts/resources persisted.
- The import was rehearsed twice in isolated Postgres/PGlite; the second run did
  not duplicate resources or prices. Production counts match the rehearsal.
- A new private Drive archive completed at 06:52 UTC, 440,695 bytes and 1,022
  records. Its downloaded SHA-256 matches the worker's recorded checksum.
  Isolated restoration verified all nested values and relationships.
- A fresh complete local regression after the final restore fix is recorded in
  `RECIPE-PURCHASE-TEST-RESULTS-2026-09-30.json`. Browser tests use isolated API
  fixtures; backend tests execute the migrations. Live SQL checks are separate.

## Remaining limits

The current live archive has zero uploaded files; local fixtures verify photo
bytes, corruption rejection and private access, but hosted large-photo-library
capacity remains unverified. Recovery was rehearsed in an isolated database,
not by replacing live Auth or Storage. Invitation rendering/outbox rules are
tested; no new real recipient invitation was sent in this release check.
Supplier pickers currently preload up to 100 supplier records; the imported
catalog has 77. Multiple historical pack sizes from one supplier use its latest
quote; they are not separate simultaneous offers. Purchase capture does not
replace inventory receiving or bookkeeping. Website publication and an
authenticated live browser check remain dependent on the upstream merge.

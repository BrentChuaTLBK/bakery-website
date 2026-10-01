# Recipe library and costing

Release status: the original recipe library was published through upstream PR #113.
The purchase/access follow-up was merged through upstream PR #114; its backend
was deployed on 30 September. See [release details](RECIPE-PURCHASE-RELEASE-2026-09-30.md).

## Access and approval

Open **Recipes & costing** from the dashboard. On **Staff Access → Staff → Accounts & invitations**, the owner enters an
email and selects Chef or Kitchen permission. An invitation email is queued.
Existing verified accounts receive access immediately; new accounts must sign up
and verify the invited email within 14 days. Recipe access alone does not create
a shop staff account. The owner can change/revoke access or resend an invitation.
Ordinary staff and customers receive no recipe access automatically.

| Permission | Access |
| --- | --- |
| Owner | All editing, costs, permissions, backups and status changes |
| Chef | Drafts, master resources, production records and costs; cannot mark Final. R&D formulas and testing logs require Can view R&D. |
| Kitchen | Published production recipes, packaging, special equipment, temporary scaling and checkoffs, subject to scheduled access and recipe scope; no printing or exports |

Each active account with recipe access has one **Can view R&D** checkbox on
**Staff Access**, controlled by the owner. It enables research recipes and test
logs; new and existing non-owner accounts start with it off. Owners always have
R&D access. Enable it after a new invitee activates recipe access.

An enabled Chef can view/edit research recipes and their logs using existing
Chef rights. An enabled Kitchen account gets a **Final / R&D** switch for
reading research formulas; editing, costs, private notes and testing logs remain
unavailable. The same hours, calendar blocks, account modes, temporary overrides and recipe scope apply to both collections. Ordinary production browsing continues to use the last Final.
Without the flag, R&D recipes, searches, historical R&D versions, test logs and
their exclusive attachments are inaccessible. If a recipe has a new R&D version,
normal staff can still read its previously published Final but cannot edit its
restricted working version. Linked recipes and export requests are checked too.

Kitchen requests are authorized on the server and return only permitted fields. Visible pages revalidate every 10 seconds with a maximum 15-second lease, clear on expiry/offline/background events, and reauthorize on return. Staff images use an authenticated no-store endpoint; direct Storage reads and signing are denied. Signed attachment URLs issued before this release can retain their old expiry of up to 15 minutes. Previously captured information cannot be withdrawn.

See [STAFF-RECIPE-SECURITY.md](STAFF-RECIPE-SECURITY.md) for the bulk calendar workflow, rules, security tests, recovery, and UI review.

Kitchen responses are filtered on the server. Costs, supplier details, private
notes, testing logs, ordinary draft formulas and version history are excluded from their responses,
not simply hidden in the interface. Files use the private `recipe-files` bucket
and expiring authorized links. The page has `noindex`; authorization is enforced
separately by the database and Storage policies.

## Create and organize

Create a recipe manually or import a source and review the draft. Each recipe has
a unique internal code, name, description, category/subcategory, tags, status and
saved versions. Custom categories and tags can be edited. Named size variants
have their own yield, ingredient groups, method, baking stages and packaging.

Ingredient rows include original quantity text, unit, ingredient reference,
brand, supplier, notes, optional formula percentage, price snapshot and practical
rounding increment. Drag rows to reorder or use their arrow buttons. Alt+Enter
in an ingredient row adds another row. The editor's section links reduce scrolling.
The compact row keeps the ingredient name, brand, quantity and unit visible.
The current supplier appears on a separate line. **Details** expands notes, brand
editing and rounding options. If an older linked row has no saved brand, the
catalog brand is displayed as a labeled fallback without changing that saved row.

Use separate groups for sponge, filling, icing, syrup or assembly. Methods support
steps, timers, temperature, equipment, warnings and process photos. Finished
photos, packaging photos, dimensions, special equipment, production notes and
private notes have their own fields. Multiple baking stages can retain different
top/bottom heat, actual temperature, fan, time and cooling/freezing information.

The library is alphabetical and paginated. Search/filter by name or ingredient,
category, tag, status, flavor, product line, version, author and update date.
Favorites, pins and recently used views are personal to each account.
**Back to results** restores the previous filters, scroll position and rendered
results after rechecking the signed-in account and permissions. Writes, explicit
**Refresh results**, account changes and sign-out invalidate retained results.

## Ingredients and packaging tables

Both tabs show compact rows with the name, brand or packaging dimensions,
purchase pack price, and cost per unit. Mass prices use **per g**, volume prices
use **per ml**, and pieces use **per pc**. Other units, such as sheets, boxes or
packs, keep their recorded unit; no contents or mass-to-volume conversion is assumed.
For example, PHP 620 for 10 kg displays PHP 0.062/g; PHP 300 for 10 pieces displays
PHP 30/pc. Small positive costs never display as zero.

The price follows the existing lowest-comparable-cost or preferred-supplier
selection. These display calculations do not update stored prices or recipe versions.
Search names, sort alphabetically or by unit cost within compatible units and
currencies, and switch between Compact and Comfortable spacing. Spacing is saved
in this browser and shared between the two tabs. Search returns up to 100 matching
records; sorting applies to those results. Refine the search for a larger catalog.
On phones, each table row stacks its name and prices beside its actions.

Suppliers, Equipment, and Categories also use compact searchable tables, with
contact details, equipment notes, or the parent category alongside the name.
Their spacing shares the same Compact/Comfortable browser preference.

Owners can **Delete** an ingredient, supplier, packaging item, equipment item, or
category from its row or editor. Confirming moves it to **Deleted records**, where
**Restore** brings it back. These are recoverable deletions: existing recipe
versions, purchase-price history, attachments, and backup archives retain their
references and data. Chefs can still edit available resources but cannot delete or
restore catalog records. Stale edits cannot reactivate a deleted record.

Deleted suppliers disappear from new supplier choices. If a preferred supplier is
deleted, new price lookups use another available comparable quote; existing recipe
cost snapshots stay unchanged. Restoring that supplier restores its availability
and retained preferences. A category with available subcategories must have those
children moved or deleted first; restore a parent before its deleted children.

## Preserve approved formulas

Saving creates an immutable version and keeps the editor open for continued work.
The statuses are **Draft, R&D, Final, Hidden, Archive**. Only the owner can mark Final
or change status directly from the saved recipe. Historical Testing displays as
R&D, Approved as Draft, and Production as Final; stored versions are not rewritten.
A new Draft or R&D version does not replace the last Final used by the kitchen.
Explicitly changing status to Draft, Hidden or Archive withdraws kitchen access;
use Hidden to withdraw a recipe while keeping it in the admin library.
Archive is excluded from the default library. A status change creates a new
version with the exact formula and saved cost snapshot; it does not reprice it.
Draft autosave is a separate recovery record and never republishes a recipe.
Concurrent edits are checked using a revision number before saving.

History supports viewing, comparing, duplicating and restoring prior versions.
Restoring creates a new version; it does not rewrite the old record. Deletion is
recoverable. Referenced components cannot be deleted while a parent needs them.

Duplicate as an independent recipe, variation or testing copy. Variations retain
their base version and display changed rows. Existing variations do not silently
adopt later changes to the base. This implementation stores a reproducible resolved
formula rather than dynamically inheriting mutable values at production time.

R&D logs keep their own dated observations, changes, baking settings, rating,
next test, photos and proposed formula. A successful test can be explicitly
promoted into a new version. Editing a testing log does not edit the approved recipe.
**New test** opens formula and observations together, with two panes on phones.
**Save test** saves both against the original source version. Tests use explicit
Save rather than ordinary recipe autosave; leaving unsaved changes requires
confirmation. Promotion is a separate owner action. Promoted tests remain locked,
and reopening a test uses its original source even after the master recipe changes.

## Production and scaling

Kitchen view uses large controls and no formula-editing controls. Choose a size and
scale by multiplier, yield, pieces, portions, portion weight, batter/dough weight
or pan count. Ingredient tables show the quantity needed for the selected run.
Original formula values remain unchanged. Save a scaled copy only when a new
saved recipe is intended. Invalid quantities or rounding hide the numeric recipe
and disable print/export until corrected. **×1, ×2, ×3** and **Custom** provide
quick scaling. Wide tablets show named section buttons; phones retain a section
selector and previous/next buttons. Owner/chef accounts can return to recipe admin.

Scaling uses rational arithmetic, including mixed and additive fractions. Exact
values are preserved; display rounding is explicit. Whole-gram or row-specific
practical increments show a rounded marker. Units convert only within compatible
weight or volume units. Cups are not guessed into grams, and eggs are not guessed
into a weight. Baking times and temperatures are never multiplied automatically.

For portion-size scaling, the number of pieces stays the same and ingredient mass
changes. For piece scaling, the portion size stays the same and piece count changes.

Linked components point to a saved approved version and named size. Their required
quantity is expressed in the component yield unit. An available update is shown
for explicit adoption. Ingredient totals and CSV/PDF exports expand linked
components. Exact component quantities are the default; optional whole batches
show the required amount, prepared amount and leftovers. Rounding is applied per
linked component requirement, not as a cross-order production optimizer.

Ingredient/step checkoffs are temporary. Owner/chef users can record completed
production with planned and actual yield against the exact version used. These
records do not modify formulas. Kitchen permission alone cannot record or edit
production records.

## Costs and allergens

Use **Record purchase** from Ingredients, Packaging or Suppliers to enter the item,
brand, supplier, total price, total quantity, unit, purchase date and notes together.
One save creates missing supplier/item records and records a price. Existing
matching names and brands are reused; retrying a save does not duplicate it.
This records purchase pricing for costing; stock receipts and accounting expense
posting are separate workflows.

For an existing ingredient or packaging item, use its **Record price** row action.
It locks the exact item and brand, prefills the selected supplier and saved pack
quantity/unit, and asks for the new amount. Changing supplier loads that supplier's
pack details. Saving appends price history and leaves recipe snapshots unchanged.

An item can have several supplier quotes. Automatic selection compares the latest
quote from each active supplier using compatible units, then selects the lowest
unit cost. A preferred supplier overrides automatic selection. If that supplier
has no compatible price, costing shows the missing price instead of silently
choosing someone else. Earlier prices remain in history. Pack sizes in unrelated
units (for example a box versus grams) are not assumed equivalent.

Packaging supports supplier links without a price and up to ten private photos,
including captions. These uploads are included in recipe backup archives.

Maintain reusable ingredients, suppliers, packaging and equipment. Supplier item
links and price history are retained. Add ingredient purchase size, purchase price
and unit; compatible-unit conversions calculate cost per quantity used. Packaging
can reference a priced master item. Other direct charges can be variable or fixed
for one production run.

Each size has **Costing Only** or **Saleable Product Costing**. Saleable products
require an explicit finished saleable yield, unit (item, box, cake, tray or set),
selling price and price basis (per item or base batch). Raw batter weight is never
assumed to be saleable yield. Labor & Utilities is a percentage allowance on the
base cost, not a profit markup:

- Base cost = ingredients + packaging + other direct costs.
- Allowance = base cost × allowance percentage / 100.
- Adjusted cost = base cost + allowance.
- Profit = selling revenue − adjusted cost.
- Margin = profit / selling revenue × 100; undefined at zero revenue.
- Markup = profit / adjusted cost × 100; undefined at zero adjusted cost.

Negative profit stays visible. Missing prices/conversions suppress full totals,
profit, margin and markup while listing the missing items and known costs.
Zero purchase prices remain explicit and receive a confirmation reminder.
The summary includes per-batch and per-saleable-unit values and break-even price.
Portion-weight scaling raises costs while retaining the saleable item count.

**Costing Overview** compares saved current-version costs by product and size.
It supports search, category, product line, status, missing/negative/profitable
costs, recent updates and cost/profit/margin sorting. Open a product to compare
current active prices with its saved snapshot. Snapshots over 90 days old get an
informational reminder. No selling price is automatically changed.
Desktop uses a compact comparison table; phones use stacked cards. **Batch / Unit**
changes every money column to the selected basis and labels the yield or sale unit.
**Details** expands supporting figures. The costing dialog has explicit **Saved /
Current** price controls, a consistent batch/unit basis, five main figures, and an
expandable breakdown. On phones it fills the available screen with a sticky Close
button; Escape also closes it.

Saved recipes capture historical cost snapshots, including pinned component and
packaging costs. A current cost preview is separate. A master price update does
not rewrite historical costs, approved formulas or shop selling prices. Current
costing reprices the same pinned component formulas recursively; saved costing
retains each component's historical costs. Component allowance is not silently
added again to parent base cost. Legacy snapshots reconstruct from saved amounts,
never current quotes. PostgreSQL is the saved/current costing authority; browser
rational arithmetic handles quantity scaling and unit-price previews. Missing
prices and unsupported unit conversions remain visibly incomplete rather than
being represented as a complete zero-cost formula.

Allergens derive from selected master ingredients and pinned components, with an
explicit manual override. This is an internal recipe aid, not a certification of
allergen compliance or cross-contact safety.

## Imports and exports

Supported imports: `.docx`, text/scanned PDF, common image files and pasted text.
Extraction and OCR run locally in the browser with vendored libraries and English
OCR data. The source is retained privately when saved. Review ingredients, units,
fractions, yields and instructions before approval; OCR can misread them.

Limits: 25 MB per uploaded file, 100 PDF pages and 250,000 extracted characters.
Old `.doc` files need conversion to `.docx`. Embedded product/process photos are
not automatically extracted from Word/PDF into the photo fields; add those photos
separately. Complex table layouts and handwriting may need substantial correction.
Imports never infer that an incomplete formula is ready for production.

For authorized Owner/Admin and existing Chef accounts, **Print / PDF** opens a prepared print layout; choose Save as PDF in the browser.
Choose kitchen A or branded presentation B, A4/Letter, typography, spacing,
page-break preferences and optional content. Packaging, special equipment and
extra notes use a separate reference page when content exists. Export a single
recipe, selected recipes or a category/book with an alphabetical contents page.
Pagination is browser-generated; inspect the print preview when changing fonts.

Kitchen Staff have no export controls, and direct export requests are denied. Browser printing and casual copying are deterred in Kitchen View.

Ingredient CSV preserves structured rows and protects spreadsheet text cells from
formula injection. Combined totals do not merge ingredients with incompatible units.

## Backups and recovery

See [RECIPE-BACKUPS.md](RECIPE-BACKUPS.md) for the exact archive contents,
schedule, retention, deployment steps, recovery procedure and runtime limits.
See [RECIPE-RELEASE-2026-09-30.md](RECIPE-RELEASE-2026-09-30.md) for test evidence
and outstanding production verification.

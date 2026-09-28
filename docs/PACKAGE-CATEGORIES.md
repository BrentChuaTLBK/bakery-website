# Package categories

Party Packages starts with **50 pax**, **100 pax**, and **150 pax**. Existing packages are assigned using the capacity stated in their subtitle or name. Prices, names, inclusions, publication status, and the order within each group are preserved. Packages without a matching capacity stay uncategorized.

## Owner controls

- Open **Party packages → Manage categories** to add or rename headings, move them with the arrows, or remove them. Save changes when finished.
- Open a package's **Edit** dialog and choose its **Category**. This also works when adding or duplicating a package.
- Drag a package's handle to rearrange it within its category. Keyboard arrows work too; ordering saves automatically.
- Duplicates retain their category and inclusions, and start hidden until published.
- Removing a category keeps its packages. They appear under **More packages** on the website until reassigned. Empty categories do not appear publicly.
- Dessert Bar has the same independent category controls, without prefilled pax categories.

## Public layout

Every category and inclusion remains expanded. Optional jump links scroll to a heading without filtering out the other packages. Three wider cards fit across desktop screens, two on tablets, and one on phones. Longer inclusion details use a readable sans-serif font; branded headings and prices remain.

## Storage and compatibility

Categories have stable UUIDs and foreign-key membership. Category edits save as one transaction with a snapshot check. Concurrent edits are rejected; a retry after a lost response is safe. Category removal clears assignments and increments affected package revisions without deleting packages. Public responses include only categories that contain published packages. Older browser versions can still edit packages without clearing their category.

## Validation

- Local PGlite backend suite: 64 migrations, 380 checks, including category authorization, validation, membership, removal, retries, stale saves, and separation between Party Packages and Dessert Bar.
- Local browser fixtures: category management, assignment, duplication, package reordering, preserved drafts after failures, visible inclusions, escaped custom names, and responsive layouts at 1440, 768, 390, and 320 pixels.
- Existing Party Packages, Dessert Bar, and mouse/touch/keyboard package-ordering regression suites.

No live load testing or test orders are needed for this feature.

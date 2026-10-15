# Recipe visibility

Recipes have a visibility setting independent of Draft, R&D, Final, Hidden, or Archive status.

- **Shared with staff** is the default for existing recipes and newly created recipes. Existing role, R&D, schedule, and recipe-scope permissions still apply.
- **Owner only** restricts the recipe to verified owners, including all saved versions. Chef and Kitchen accounts cannot change this setting.
- Duplicating, scaling, or recovering a working copy of an owner-only recipe retains its privacy to prevent an accidental disclosure. The owner can explicitly share the copy afterward.

An owner can change visibility on the recipe screen or while editing. Changing visibility does not publish a recipe, withdraw its Final version, or change its formula. A separate visibility change requires the current revision so an older browser cannot overwrite a newer decision.

The editor applies its selection when Save is clicked. An autosaved private draft protects new draft-only attachments without withdrawing photos already used by a saved shared recipe.

## Linked recipes and files

Staff cannot open a recipe version that depends on an owner-only recipe, including pinned components and variation bases. Staff lists and search counts omit inaccessible recipes. Restoring staff visibility allows access again, subject to the other permissions.

The same access rules apply to direct requests, historical versions, costing, test logs, working drafts, production history, scaling, exports, and recipe files. A private attachment cannot be made accessible by attaching it to another recipe or a shared resource.

The application rechecks an open recipe and clears an inaccessible view. Previously downloaded or printed material cannot be recalled. File links already issued before a visibility change retain their existing expiry (up to 15 minutes); new file requests must pass the updated permission check.

Academy teaching recipes are independent copies explicitly published by the owner. Changing a Production recipe's visibility does not withdraw an existing Academy teaching copy.

## Recovery and release

Recipe backups preserve visibility. Older backups without the field restore recipes as Shared with staff, matching their previous behavior. Final-only backups keep their existing scope and include owner-only Finals.

The migration and frontend must both be released for the setting to be available. No existing recipe is automatically made owner-only.

## Validation

Run `npm run test:recipe-privacy` for the focused security, backup, browser, and print checks. Backend contracts cover owner, Chef, and Kitchen access, dependency restrictions, file provenance, stale revisions, and default sharing. Browser checks cover owner controls, staff restrictions, draft recovery, narrow screens, and a visibility change during print preparation. The existing recipe, staff-access, and backup suites provide regression coverage.

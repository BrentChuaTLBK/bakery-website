-- History marker for a completed, one-off audit Storage cleanup.
-- The applied temporary DELETE policy was restricted to an approved test owner,
-- five test uploads and a ten-minute expiry, then immediately removed by
-- 20261001065854_academy_reaudit_remove_photo_cleanup_permission.sql.
-- Fixture account and object identifiers are deliberately not published.
-- Fresh installs need no temporary permission; the permanent schema is unchanged.
do $audit_history$ begin null; end $audit_history$;

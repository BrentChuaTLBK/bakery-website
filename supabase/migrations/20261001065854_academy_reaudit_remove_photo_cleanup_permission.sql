-- The five controlled audit photos were removed through the authenticated Storage API.
-- Retain the migration history of this completed cleanup; no deletion capability remains.
drop policy if exists academy_reaudit_test_photo_delete on storage.objects;

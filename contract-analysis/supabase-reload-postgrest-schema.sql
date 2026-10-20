-- Run after creating new tables so the upload script (PostgREST API) sees them immediately.
notify pgrst, 'reload schema';

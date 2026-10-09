-- Folders must never be flagged for AI extraction.
update public.contract_drive_uploads
set ai_extraction = 'No'
where item_type = 'folder'
  and ai_extraction = 'Yes';

-- Reconcile file rows for a sync (PDF-only when multiple contract files share the same folder):
-- POST https://contract-extraction-joyy.onrender.com/drive/reconcile-ai?sync_id=<uuid>
-- Or: node contract-uploading/reconcile-ai-extraction.mjs <sync_id>

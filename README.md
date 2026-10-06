# Mews Data Integration

| Folder | Role |
| --- | --- |
| `contract-uploading` | Google Drive web app. Copies the contract folder into Supabase Storage. |
| `contract-extraction` | Render service. Extracts contract fields from Storage into Postgres. |
| `contract-analysis` | Invoice comparison against the guest report (workbooks and scripts). |

## Render

Service **Contract-extraction** (`srv-d7b2bofafjfc739bu4cg`), https://contract-extraction-joyy.onrender.com

| Setting | Value |
| --- | --- |
| Repository | `tech4lifeatepisode/Mews-Data-Integration` |
| Branch | `main` |
| Root directory | empty |
| Build command | `npm install` |
| Start command | `npm start` |
| Region | Frankfurt (EU Central) |

`npm start` runs `contract-extraction/server.mjs`, which also serves the Drive upload routes.

## Supabase

Project `jujvtuyksxkoclegjznb`, bucket `Contracts`.

Drive files are uploaded under the new prefix `Google Drive/`, keeping the Drive subfolders beneath it. Extraction still reads `SUPABASE_STORAGE_FOLDER` (default `To Fill 2`) until that variable is pointed at `Google Drive`.

## Drive upload

1. In Google Cloud Console, add this authorized redirect URI: `https://contract-extraction-joyy.onrender.com/drive/oauth/callback`
2. On Render, set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` from the OAuth web client. Do not commit the client secret JSON.
3. Set `SUPABASE_SERVICE_ROLE_KEY`.
4. Run `contract-uploading/supabase-drive-upload-log.sql` in the Supabase SQL editor (or the migration SQL files if the table already exists). Each file row gets `path_category`, `file_format` (PDF / DOCX / Other), `nc_number`, and `ai_extraction` (reconciled after each sync: **Contracts** + **NC_0574+**, one file → Yes; multiple → PDF wins, else one DOCX, else one file).
5. Open `/drive`, authorize, then start the sync.

Source folder: https://drive.google.com/drive/folders/1yolAv0AGafMmsdNCtc58Qrk8HHJURysS

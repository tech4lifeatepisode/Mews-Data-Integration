/**
 * HTTP server for Render Web Service (binds to PORT).
 * Contract extraction: /extract, /extract-all
 * Google Drive upload: /drive
 */
import http from 'http';
import { runExtractFromSupabaseStorage, isEnvTruthy } from './extract-from-storage.mjs';
import {
  runDriveAiExtraction,
  runMissingFromReviewDriveExtraction,
  DRIVE_EXTRACTION_TABLE,
  CUSTOMERS_CONTRACTS_TABLE,
  DRIVE_EXTRACTION_LOG_TABLE,
} from './extract-drive-ai.mjs';
import { runExtractFromSupabaseStorageUntilDone } from './extract-from-storage-batch.mjs';
import { runB2bDriveExtraction, B2B_COMPANIES_TABLE } from './extract-b2b-drive.mjs';
import { driveHealthLines, handleDriveHttp } from '../contract-uploading/drive-http.mjs';

const port = Number(process.env.PORT) || 3000;

let extractionRunning = false;

function checkExtractAuth(req) {
  const secret = process.env.EXTRACT_TRIGGER_SECRET;
  const provided = req.headers['x-extract-secret'];
  if (secret && provided !== secret) {
    return false;
  }
  return true;
}

async function safeRunExtract(label) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const r = await runExtractFromSupabaseStorage();
    console.log(`[${label}] Extraction finished:`, r);
    return { ok: true, ...r };
  } catch (e) {
    console.error(`[${label}] Extraction failed:`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunExtractAll(label) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const r = await runExtractFromSupabaseStorageUntilDone();
    console.log(`[${label}] Full batch run finished:`, r);
    return r;
  } catch (e) {
    console.error(`[${label}] Full batch run failed:`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunDriveAi(label, options = {}) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runDriveAiExtraction(options);
    console.log(`[${label}] Drive AI extraction finished:`, result);
    return result;
  } catch (error) {
    console.error(`[${label}] Drive AI extraction failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunMissingFromReview(label) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runMissingFromReviewDriveExtraction();
    console.log(`[${label}] Missing-from-review extraction finished:`, result);
    return result;
  } catch (error) {
    console.error(`[${label}] Missing-from-review extraction failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunNcOcrRerunAll(label) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const r = await runNcOcrRerunAllFolders();
    console.log(`[${label}] OCR rerun (all folders) finished:`, r);
    return r;
  } catch (e) {
    console.error(`[${label}] OCR rerun failed:`, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunB2b(label) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runB2bDriveExtraction();
    console.log(`[${label}] B2B extraction finished:`, result);
    return result;
  } catch (error) {
    console.error(`[${label}] B2B extraction failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    extractionRunning = false;
  }
}

function parseDriveAiOptions(reqUrl) {
  const query = new URL(reqUrl || '/', 'http://localhost').searchParams;
  const ncRaw = query.get('nc') || query.get('ncs') || '';
  const ncs = ncRaw
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^NC_/i, ''))
    .filter(Boolean);
  if (!ncs.length) return {};
  const useCustomers = query.get('table') !== 'legacy';
  return {
    extractionTable: useCustomers ? CUSTOMERS_CONTRACTS_TABLE : DRIVE_EXTRACTION_TABLE,
    ncAllowlist: new Set(ncs),
    skipNcAlreadyInExtractionTable: query.get('force') !== '1',
  };
}

function handleExtractRequest(req, res, mode) {
  if (!checkExtractAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'OPENAI_API_KEY not set' }));
    return;
  }

  const message =
    mode === 'b2b'
      ? `B2B ai_extraction=Yes extraction started into ${DRIVE_EXTRACTION_TABLE} and ${B2B_COMPANIES_TABLE}`
      : mode === 'missing-from-review'
        ? `Missing-from-review ai_extraction=Yes extraction started into ${CUSTOMERS_CONTRACTS_TABLE}`
        : mode === 'drive-ai'
        ? 'Drive ai_extraction=Yes extraction started until every pending file is saved'
        : mode === 'nc-rerun-all'
          ? 'OCR rerun (filtered NCs across To Fill 1, To Fill 2, Fill 3) started in background'
          : mode === 'all'
            ? 'full extraction (all pending batches) started in background'
            : 'extraction started in background';

  const modeKey =
    mode === 'b2b'
      ? 'extract-b2b'
      : mode === 'missing-from-review'
        ? 'extract-missing-from-review'
      : mode === 'drive-ai'
        ? 'extract-drive-ai'
        : mode === 'nc-rerun-all'
          ? 'extract-nc-rerun-all'
          : mode === 'all'
            ? 'extract-all'
            : 'extract';

  res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: true, accepted: true, message, mode: modeKey }));

  setImmediate(() => {
    if (mode === 'b2b') {
      safeRunB2b('http').catch((e) => console.error(e));
    } else if (mode === 'missing-from-review') {
      safeRunMissingFromReview('http').catch((e) => console.error(e));
    } else if (mode === 'drive-ai') {
      const driveOpts = parseDriveAiOptions(req.url);
      safeRunDriveAi('http', driveOpts).catch((e) => console.error(e));
    } else if (mode === 'nc-rerun-all') {
      safeRunNcOcrRerunAll('http').catch((e) => console.error(e));
    } else if (mode === 'all') {
      safeRunExtractAll('http').catch((e) => console.error(e));
    } else {
      safeRunExtract('http').catch((e) => console.error(e));
    }
  });
}

function extractionHealthLines() {
  const table = process.env.EXTRACTION_TABLE || 'contract_extractions';
  const ncFilter = process.env.EXTRACTION_NC_FILTER?.trim();
  return (
    'Contract extraction:\n' +
    `  EXTRACTION_TABLE=${table}\n` +
    (ncFilter ? `  EXTRACTION_NC_FILTER=${ncFilter.slice(0, 80)}${ncFilter.length > 80 ? '…' : ''}\n` : '') +
    '  POST/GET /extract — one batch (MAX_EXTRACTION_FILES).\n' +
    '  POST/GET /extract-all — all pending in SUPABASE_STORAGE_FOLDER.\n' +
    '  POST/GET /extract-nc-rerun-all — OCR rerun for filtered NCs across To Fill 1/2/Fill 3.\n' +
    `  POST/GET /extract-drive-ai — all ai_extraction=Yes files from ${process.env.SUPABASE_STORAGE_FOLDER || 'Google Drive'} into ${DRIVE_EXTRACTION_TABLE}. Optional ?nc=1796 (comma-separated) targets NCs into ${CUSTOMERS_CONTRACTS_TABLE}. Files over 25MB are skipped.\n` +
    `  POST/GET /extract-missing-from-review — allowlisted NCs with ai_extraction=Yes into ${CUSTOMERS_CONTRACTS_TABLE} (skip NCs already there).\n` +
    `  POST/GET /extract-b2b — B2B ai_extraction=Yes files from ${process.env.SUPABASE_STORAGE_FOLDER || 'Google Drive'} into ${DRIVE_EXTRACTION_TABLE} and ${B2B_COMPANIES_TABLE}.\n` +
    `  Log table ${DRIVE_EXTRACTION_LOG_TABLE}.\n` +
    '  AUTO_EXTRACT_FROM_STORAGE=true: on boot, extract-all for one folder.\n' +
    '  AUTO_NC_OCR_RERUN_FROM_STORAGE=true: on boot, extract-nc-rerun-all.\n' +
    '  Optional header: X-Extract-Secret: <EXTRACT_TRIGGER_SECRET>\n' +
    '\n' +
    driveHealthLines()
  );
}

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] || '/';

  if (url === '/' || url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(
      'Contract extraction service OK.\n\n' +
        extractionHealthLines(),
    );
    return;
  }

  if (await handleDriveHttp(req, res)) {
    return;
  }

  if (url === '/extract' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'single');
    return;
  }

  if (url === '/extract-all' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'all');
    return;
  }

  if (url === '/extract-nc-rerun-all' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'nc-rerun-all');
    return;
  }

  if (url === '/extract-b2b' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'b2b');
    return;
  }

  if (url === '/extract-drive-ai' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'drive-ai');
    return;
  }

  if (url === '/extract-missing-from-review' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'missing-from-review');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Listening on 0.0.0.0:${port}`);

  const autoNcRerun = isEnvTruthy('AUTO_NC_OCR_RERUN_FROM_STORAGE');
  const autoExtract = isEnvTruthy('AUTO_EXTRACT_FROM_STORAGE');
  // #region agent log
  fetch('http://127.0.0.1:7786/ingest/4229d02c-1770-4fd5-9da6-3795ca151e32',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'002cbb'},body:JSON.stringify({sessionId:'002cbb',hypothesisId:'E',location:'server.mjs:listen',message:'boot extraction flags',data:{autoExtract,autoNcRerun,rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed},timestamp:Date.now()})}).catch(()=>{});
  // #endregion

  if (autoNcRerun) {
    console.log(
      'AUTO_NC_OCR_RERUN_FROM_STORAGE: scheduling OCR rerun across To Fill 1, To Fill 2, Fill 3 NC_1250-NC_1470...',
    );
    setImmediate(() => {
      safeRunNcOcrRerunAll('startup').catch((e) => console.error(e));
    });
  } else if (autoExtract) {
    console.log('AUTO_EXTRACT_FROM_STORAGE: scheduling full batch extraction (all pending files)...');
    setImmediate(() => {
      safeRunExtractAll('startup').catch((e) => console.error(e));
    });
  }

});

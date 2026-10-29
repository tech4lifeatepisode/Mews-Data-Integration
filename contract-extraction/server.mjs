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
import { runReextractRentMismatch } from './reextract-rent-mismatch.mjs';
import { runReextractRentProductsV6V7 } from './reextract-rent-products-v6-v7.mjs';
import { runChamariCompanyReextract } from './reextract-chamari-company-from-drive.mjs';
import { runV3B2bContractReextract } from './reextract-v3-b2b-contracts-from-drive.mjs';
import { runPublishAfterV3B2bReextract } from './publish-after-v3-b2b-reextract.mjs';
import { parseNcNumbersFromQuery } from './parse-nc-query.mjs';
import {
  runB2c2810DriveExtraction,
  ensureB2c2810ExtractionTable,
  B2C_28_10_EXTRACTION_TABLE,
} from './extract-b2c-28-10-2026.mjs';

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

async function safeRunB2c2810UntilDone(label, { fillGaps = false, reextractNc = false } = {}) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  const maxRounds = Number(process.env.B2C_EXTRACTION_MAX_ROUNDS) || 200;
  let last = null;
  try {
    const ddl = await ensureB2c2810ExtractionTable();
    if (!ddl.ok) {
      console.warn(`[${label}] B2C table DDL via Postgres skipped/failed:`, ddl.error);
    }
    for (let round = 1; round <= maxRounds; round += 1) {
      last = await runB2c2810DriveExtraction({
        skipNcAlreadyInTable: !reextractNc,
        skipAlreadyExtracted: fillGaps || reextractNc ? false : undefined,
      });
      console.log(`[${label}] B2C 28-10 round ${round}:`, last);
      if (last.pending === 0) break;
      if (last.success === 0 && last.failed === 0) break;
    }
    return { ok: true, rounds: maxRounds, ...last };
  } catch (error) {
    console.error(`[${label}] B2C 28-10 extraction failed:`, error);
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

async function safeRunV3B2bContracts(label, options = {}) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runV3B2bContractReextract(options);
    console.log(`[${label}] V3 B2B contract re-extract finished:`, {
      ok: result.ok,
      targetNcs: result.targetNcs,
      failed: result.failed,
    });
    return { ok: true, ...result };
  } catch (error) {
    console.error(`[${label}] V3 B2B contract re-extract failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunPublishV3B2bAfterReextract(label) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runPublishAfterV3B2bReextract();
    console.log(`[${label}] V3 B2B publish pipeline finished:`, result);
    return result;
  } catch (error) {
    console.error(`[${label}] V3 B2B publish pipeline failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    extractionRunning = false;
  }
}

async function safeRunChamariCompanies(label, options = {}) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runChamariCompanyReextract(options);
    console.log(`[${label}] CHAMARI company re-extract finished:`, {
      ok: result.ok,
      targetNcs: result.targetNcs,
      failed: result.failed,
    });
    return { ok: true, ...result };
  } catch (error) {
    console.error(`[${label}] CHAMARI company re-extract failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
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

function parseReextractRentMismatchOptions(reqUrl) {
  const query = new URL(reqUrl || '/', 'http://localhost').searchParams;
  return {
    dryRun: query.get('dry_run') === '1' || query.get('dryRun') === '1',
    force: query.get('force') === '1' || query.get('force') === 'true',
    concurrency: Math.min(8, Math.max(1, Number(query.get('concurrency')) || 4)),
  };
}

async function safeRunReextractRentMismatch(label, options = {}) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runReextractRentMismatch(options);
    console.log(`[${label}] Rent mismatch re-extraction finished:`, result);
    return result;
  } catch (error) {
    console.error(`[${label}] Rent mismatch re-extraction failed:`, error);
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    extractionRunning = false;
  }
}

function parseReextractRentProductsV6V7Options(reqUrl) {
  const query = new URL(reqUrl || '/', 'http://localhost').searchParams;
  const ncs = parseNcNumbersFromQuery(query);
  const limitRaw = query.get('limit');
  return {
    dryRun: query.get('dry_run') === '1' || query.get('dryRun') === '1',
    notesOnly: query.get('notes_only') === '1' || query.get('notesOnly') === '1',
    retryErrors: query.get('retry_errors') === '1' || query.get('retryErrors') === '1',
    ncFilter: ncs.length ? new Set(ncs) : null,
    limit: limitRaw != null && limitRaw !== '' ? Number(limitRaw) : undefined,
  };
}

async function safeRunReextractRentProductsV6V7(label, options = {}) {
  if (extractionRunning) {
    console.warn(`[${label}] Extraction already running, skip.`);
    return { ok: false, skipped: true, message: 'already_running' };
  }
  extractionRunning = true;
  try {
    const result = await runReextractRentProductsV6V7(options);
    console.log(`[${label}] V6/V7 rent+products re-extraction finished:`, {
      updated: result.updated,
      targetRows: result.targetRows,
      errors: result.errors,
    });
    return result;
  } catch (error) {
    console.error(`[${label}] V6/V7 rent+products re-extraction failed:`, error);
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

function parseChamariReextractOptions(reqUrl) {
  const query = new URL(reqUrl, 'http://127.0.0.1').searchParams;
  const ncs = parseNcNumbersFromQuery(query.get('nc') || query.get('ncs') || '');
  return {
    dryRun: query.get('dry_run') === '1',
    ncFilter: ncs.length ? new Set(ncs) : null,
  };
}

function parseV3B2bReextractOptions(reqUrl) {
  const query = new URL(reqUrl, 'http://127.0.0.1').searchParams;
  const ncs = parseNcNumbersFromQuery(query.get('nc') || query.get('ncs') || '');
  const limitRaw = query.get('limit');
  return {
    dryRun: query.get('dry_run') === '1',
    ncFilter: ncs.length ? new Set(ncs) : null,
    limit: limitRaw != null && limitRaw !== '' ? Number(limitRaw) : undefined,
  };
}

function hasSupabaseServiceKey() {
  return !!(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
}

function handleExtractRequest(req, res, mode) {
  if (!checkExtractAuth(req)) {
    res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
    return;
  }

  const rentProductsOpts =
    mode === 'rent-products-v6-v7' ? parseReextractRentProductsV6V7Options(req.url) : null;

  if (mode === 'rent-products-v6-v7' && !hasSupabaseServiceKey()) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: false,
        error: 'SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY not set on Render',
      }),
    );
    return;
  }

  if (!rentProductsOpts?.notesOnly && !process.env.OPENAI_API_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'OPENAI_API_KEY not set' }));
    return;
  }

  const message =
    mode === 'b2b'
      ? `B2B ai_extraction=Yes extraction started into ${DRIVE_EXTRACTION_TABLE} and ${B2B_COMPANIES_TABLE}`
      : mode === 'chamari-companies'
        ? 'CHAMARI/B42861468 company re-extract from Google Drive contracts started (updates V2/V3/FF customer + V2 companies)'
      : mode === 'v3-b2b-contracts'
        ? 'Full contract re-extract for all NCs in V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026 from Google Drive (updates Customers_Contracts_Extraction_12_10_2026)'
      : mode === 'missing-from-review'
        ? `Missing-from-review ai_extraction=Yes extraction started into ${CUSTOMERS_CONTRACTS_TABLE}`
      : mode === 'b2c-28-10'
        ? `B2C 28-10 batch ai_extraction=Yes extraction started into ${B2C_28_10_EXTRACTION_TABLE}`
        : mode === 'drive-ai'
        ? 'Drive ai_extraction=Yes extraction started until every pending file is saved'
        : mode === 'rent-mismatch'
          ? 'Rent f)/g) re-extraction for Final_Format_Mismatch_Rent NCs started (updates Allocated Rate on Final_Format customers)'
        : mode === 'rent-products-v6-v7'
          ? 'Rent equation + Mews Included Products re-extraction for NCs in V6 ∪ V7 (12_10 + 28_10 B2C extraction tables only)'
        : mode === 'nc-rerun-all'
          ? 'OCR rerun (filtered NCs across To Fill 1, To Fill 2, Fill 3) started in background'
          : mode === 'all'
            ? 'full extraction (all pending batches) started in background'
            : 'extraction started in background';

  const modeKey =
    mode === 'b2b'
      ? 'extract-b2b'
      : mode === 'chamari-companies'
        ? 'extract-chamari-companies'
      : mode === 'v3-b2b-contracts'
        ? 'extract-v3-b2b-contracts'
      : mode === 'missing-from-review'
        ? 'extract-missing-from-review'
      : mode === 'b2c-28-10'
        ? 'extract-b2c-28-10-2026'
      : mode === 'drive-ai'
        ? 'extract-drive-ai'
        : mode === 'rent-mismatch'
          ? 'extract-rent-mismatch'
        : mode === 'rent-products-v6-v7'
          ? 'extract-rent-products-v6-v7'
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
    } else if (mode === 'chamari-companies') {
      const chamariOpts = parseChamariReextractOptions(req.url);
      safeRunChamariCompanies('http', chamariOpts).catch((e) => console.error(e));
    } else if (mode === 'v3-b2b-contracts') {
      const v3Opts = parseV3B2bReextractOptions(req.url);
      safeRunV3B2bContracts('http', v3Opts).catch((e) => console.error(e));
    } else if (mode === 'missing-from-review') {
      safeRunMissingFromReview('http').catch((e) => console.error(e));
    } else if (mode === 'b2c-28-10') {
      const query = new URL(req.url || '/', 'http://127.0.0.1').searchParams;
      const fillGaps = query.get('force') === '1' || query.get('fill_gaps') === '1';
      const reextractNc = query.get('reextract_nc') === '1';
      safeRunB2c2810UntilDone('http', { fillGaps, reextractNc }).catch((e) => console.error(e));
    } else if (mode === 'drive-ai') {
      const driveOpts = parseDriveAiOptions(req.url);
      safeRunDriveAi('http', driveOpts).catch((e) => console.error(e));
    } else if (mode === 'rent-mismatch') {
      const rentOpts = parseReextractRentMismatchOptions(req.url);
      safeRunReextractRentMismatch('http', rentOpts).catch((e) => console.error(e));
    } else if (mode === 'rent-products-v6-v7') {
      const v67Opts = parseReextractRentProductsV6V7Options(req.url);
      safeRunReextractRentProductsV6V7('http', v67Opts).catch((e) => console.error(e));
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
    `  POST/GET /extract-b2c-28-10-2026 — B2C batch into ${B2C_28_10_EXTRACTION_TABLE}; runs until pending=0. ?force=1 fill gaps (re-run files not yet in B2C table, ignore extraction log). ?reextract_nc=1 also re-process NCs already in table.\n` +
    '  POST/GET /extract-rent-mismatch — re-read f) Precio / g) Descuento from Google Drive PDFs for NCs in Final_Format_Mismatch_Rent_15_10_2026; updates Final_Format customers + Customers_Contracts_Extraction_12_10_2026 Allocated Rate. ?force=1 reprocesses all; ?dry_run=1 no DB writes.\n' +
    '  POST/GET /extract-rent-products-v6-v7 — B2C contract AI for NCs in V6 ∪ V7; updates Allocated Rate (equation) + Included Products on 12_10 + 28_10 B2C tables. ?nc= comma list; ?dry_run=1; ?notes_only=1; ?retry_errors=1 (uses summary log on disk); ?limit=.\n' +
    `  POST/GET /extract-b2b — B2B ai_extraction=Yes files from ${process.env.SUPABASE_STORAGE_FOLDER || 'Google Drive'} into ${DRIVE_EXTRACTION_TABLE} and ${B2B_COMPANIES_TABLE}.\n` +
    '  POST/GET /extract-chamari-companies — re-extract De otra parte client company for NCs with CHAMARI/B42861468 (?nc=1006,1142 optional; ?dry_run=1).\n' +
    '  POST/GET /extract-v3-b2b-contracts — full contract AI re-extract for every NC in V3_Final_B2B_All_Fields_Match_Mews_Import_20_10_2026 from Google Drive (?nc= optional; ?limit= batch size; ?dry_run=1). Set SUPABASE_STORAGE_FOLDER=Google Drive on Render.\n' +
    '  POST/GET /publish-v3-b2b-after-reextract — propagate multi-NC 12_10 rows, rebuild FF 15_10, V2, and V3 B2B tables (no OpenAI; needs SUPABASE_SERVICE_ROLE_KEY).\n' +
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

  if (url === '/extract-chamari-companies' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'chamari-companies');
    return;
  }

  if (url === '/extract-v3-b2b-contracts' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'v3-b2b-contracts');
    return;
  }

  if (url === '/publish-v3-b2b-after-reextract' && (req.method === 'POST' || req.method === 'GET')) {
    if (!checkExtractAuth(req)) {
      res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
      return;
    }
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY && !process.env.SUPABASE_SECRET_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY not set' }));
      return;
    }
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        ok: true,
        accepted: true,
        message:
          'Publish pipeline started: propagate multi-NC → FF 15_10 → V2_Final_Format → V3_Final_B2B',
        mode: 'publish-v3-b2b-after-reextract',
      }),
    );
    setImmediate(() => {
      safeRunPublishV3B2bAfterReextract('http').catch((e) => console.error(e));
    });
    return;
  }

  if (url === '/extract-drive-ai' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'drive-ai');
    return;
  }

  if (url === '/extract-b2c-28-10-2026' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'b2c-28-10');
    return;
  }

  if (url === '/extract-missing-from-review' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'missing-from-review');
    return;
  }

  if (url === '/extract-rent-mismatch' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'rent-mismatch');
    return;
  }

  if (url === '/extract-rent-products-v6-v7' && (req.method === 'POST' || req.method === 'GET')) {
    handleExtractRequest(req, res, 'rent-products-v6-v7');
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Listening on 0.0.0.0:${port}`);

  const autoNcRerun = isEnvTruthy('AUTO_NC_OCR_RERUN_FROM_STORAGE');
  const autoExtract = isEnvTruthy('AUTO_EXTRACT_FROM_STORAGE');

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

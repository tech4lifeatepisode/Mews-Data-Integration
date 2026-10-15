import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const MISSING_FROM_REVIEW_644_JSON = path.join(here, 'missing-from-review-644-allowlist.json');

/** NCs not on review sheets / red list (numeric codes, typically NC_0574+). */
export function loadMissingFromReviewAllowlist() {
  if (!fs.existsSync(MISSING_FROM_REVIEW_644_JSON)) {
    throw new Error(`Missing allowlist file: ${MISSING_FROM_REVIEW_644_JSON}`);
  }
  const numbers = JSON.parse(fs.readFileSync(MISSING_FROM_REVIEW_644_JSON, 'utf8'));
  if (!Array.isArray(numbers)) {
    throw new Error(`${MISSING_FROM_REVIEW_644_JSON} must be a JSON array of NC numbers`);
  }
  return new Set(numbers.map((n) => String(n)));
}

export const CUSTOMER_DRIVE_FOLDER_ID = '1yolAv0AGafMmsdNCtc58Qrk8HHJURysS';
export const B2B_DRIVE_FOLDER_ID = '1QVZ56dy8nZ7vMOrrX3oLwR7viMaTA90s';

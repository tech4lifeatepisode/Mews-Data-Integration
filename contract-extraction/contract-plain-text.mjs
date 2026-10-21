import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { DOCX_MIME } from './extraction sandbox/sandbox-common.mjs';

function xmlToPlain(xml) {
  return String(xml || '')
    .replace(/<w:tab[^/]*\/>/g, ' ')
    .replace(/<w:br[^/]*\/>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Unzip DOCX (OOXML) and read word/document.xml as plain text. */
export function plainTextFromDocxBuffer(fileBuffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mews-docx-'));
  const docxPath = path.join(dir, 'contract.docx');
  try {
    fs.writeFileSync(docxPath, fileBuffer);
    execFileSync('tar', ['-xf', docxPath, '-C', dir], { stdio: 'pipe' });
    const xmlPath = path.join(dir, 'word', 'document.xml');
    if (!fs.existsSync(xmlPath)) return '';
    return xmlToPlain(fs.readFileSync(xmlPath, 'utf8'));
  } catch {
    return '';
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export function plainTextFromContractBuffer(fileBuffer, mimeType, fileName = '') {
  const mime = mimeType || '';
  const name = String(fileName || '').toLowerCase();
  if (mime === DOCX_MIME || name.endsWith('.docx')) {
    return plainTextFromDocxBuffer(fileBuffer);
  }
  return '';
}

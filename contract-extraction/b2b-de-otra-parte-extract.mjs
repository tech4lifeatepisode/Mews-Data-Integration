import { isChamariEntity } from './chamari-strip.mjs';
import { clean } from './company-match-utils.mjs';
import { plainTextFromContractBuffer } from './contract-plain-text.mjs';
import { MODEL, prepareFileInput } from './extraction sandbox/sandbox-common.mjs';
import { B2B_INSTRUCTIONS, extractB2bContract } from './extraction sandbox/extract-b2b.mjs';

const LITE_INSTRUCTIONS = `${B2B_INSTRUCTIONS}

Return ONLY the client company after "De otra parte" (Cliente). Ignore CHAMARI / la Empresa / landlord.`;

const LITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    company_name: { type: 'string', nullable: true },
    tax_id_number: { type: 'string', nullable: true },
    address_line_1: { type: 'string', nullable: true },
    city: { type: 'string', nullable: true },
    postal_code: { type: 'string', nullable: true },
    country_code: { type: 'string', nullable: true },
    contact_person: { type: 'string', nullable: true },
    invoicing_email: { type: 'string', nullable: true },
    telephone: { type: 'string', nullable: true },
  },
  required: [
    'company_name',
    'tax_id_number',
    'address_line_1',
    'city',
    'postal_code',
    'country_code',
    'contact_person',
    'invoicing_email',
    'telephone',
  ],
};

function deOtraParteChunk(text) {
  const raw = String(text || '');
  const block = raw.match(
    /De otra parte,\s*([\s\S]{20,5000}?)(?:\(\s*en adelante|en adelante,\s*el\s+[«"“]?Cliente|Exp[oó]n|EXPON)/i,
  );
  return block?.[1]?.trim() || null;
}

/** True when "De otra parte" names a natural person (B2C), not a company cliente. */
export function isIndividualDeOtraParte(text) {
  const chunk = deOtraParteChunk(text);
  if (!chunk) return false;
  if (/sociedad\s+constituida/i.test(chunk)) return false;
  return /^D\.?\s|^\s*Dña\.?\s|pasaporte|NIE\s|DNI\s|NIF\s+[0-9XYZ]/i.test(chunk);
}

/** Regex fallback on plain text (DOCX or OCR). */
export function parseDeOtraParteCompany(text) {
  const chunk = deOtraParteChunk(text);
  if (!chunk) return null;
  if (isIndividualDeOtraParte(text)) return { client_type: 'individual' };

  const company_name =
    chunk.match(/^(.+?)\s+sociedad\s+constituida/i)?.[1]?.trim() ||
    chunk.match(/^(.+?),\s*sociedad/i)?.[1]?.trim() ||
    chunk.match(/^(.+?)\s+con domicilio/i)?.[1]?.trim();
  const tax_id_number =
    chunk.match(/con NIF\s+([A-Z0-9]+)/i)?.[1] ||
    chunk.match(/\bNIF\s+([A-Z0-9]{8,9}[A-Z0-9]?)\b/i)?.[1];
  const address_line_1 = chunk.match(/domicilio\s+(.+?),\s*con NIF/i)?.[1]?.trim();
  const contact_person = chunk.match(/representad[oa]\s+por\s+([^,]+),/i)?.[1]?.trim() || null;
  if (!company_name || isChamariEntity(company_name)) return null;
  if (tax_id_number && isChamariEntity(tax_id_number)) return null;
  return {
    client_type: 'company',
    company_name,
    tax_id_number: tax_id_number || null,
    address_line_1: address_line_1 || null,
    city: null,
    postal_code: null,
    country_code: 'ES',
    contact_person,
    invoicing_email: null,
    telephone: null,
  };
}

async function extractCompanyLite(client, fileName, fileBuffer, mimeType) {
  const response = await client.responses.parse({
    model: MODEL,
    temperature: 0,
    max_output_tokens: 1200,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: `${LITE_INSTRUCTIONS}\n\nFile name: ${fileName}` },
          prepareFileInput(fileBuffer, mimeType, fileName),
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'b2b_client_company_lite',
        strict: true,
        schema: LITE_SCHEMA,
      },
    },
  });
  if (response.output_parsed) return response.output_parsed;
  if (response.output_text) return JSON.parse(response.output_text);
  throw new Error('Lite company extraction returned no JSON');
}

/** Full B2B schema first, then lite schema. */
export async function extractClientCompanyFromContract(client, fileName, fileBuffer, mimeType) {
  const plain = plainTextFromContractBuffer(fileBuffer, mimeType, fileName);
  if (plain) {
    const fromText = parseDeOtraParteCompany(plain);
    if (fromText?.client_type === 'individual') {
      return { client_type: 'individual', company_name: null, tax_id_number: null };
    }
    if (fromText?.company_name && !isChamariEntity(fromText.company_name)) {
      return { ...fromText, anexo_ii_notes: null, fiscal_identifier: fromText.tax_id_number };
    }
  }

  try {
    const full = await extractB2bContract(client, fileName, fileBuffer, mimeType);
    const name = clean(full.company_name);
    if (name && !isChamariEntity(name)) return { ...full, client_type: 'company' };
  } catch {
    /* try lite */
  }
  const lite = await extractCompanyLite(client, fileName, fileBuffer, mimeType);
  const name = clean(lite.company_name);
  if (!name || isChamariEntity(name)) {
    if (plain && isIndividualDeOtraParte(plain)) {
      return { client_type: 'individual', company_name: null, tax_id_number: null };
    }
    throw new Error('Client company not found or is CHAMARI');
  }
  return { ...lite, client_type: 'company', anexo_ii_notes: null, fiscal_identifier: lite.tax_id_number };
}

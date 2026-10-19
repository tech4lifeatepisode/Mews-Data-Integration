/** Match NC-linked Final_Format rows to Companies_Extraction_12_10_2026. */

export function clean(v) {
  return v == null ? '' : String(v).trim();
}

export function normId(v) {
  return clean(v)
    .replace(/\s+/g, '')
    .replace(/-/g, '')
    .toUpperCase()
    .replace(/^ES/, '');
}

export function normEmail(v) {
  const e = clean(v).toLowerCase();
  if (!e || e === '/' || e === '-') return '';
  return e;
}

export function normName(v) {
  return clean(v)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(s\.?l\.?u\.?|s\.?a\.?u?|slu|sa|sl|gmbh|llc|inc|sca)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function nameTokens(v) {
  return [...new Set(normName(v).split(' ').filter((t) => t.length > 2))];
}

export function companyNameTokens(name) {
  return nameTokens(name).filter((t) => !['the', 'de', 'del', 'los', 'las'].includes(t));
}

export function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

export function isLikelyCompanyLabel(text) {
  const blob = clean(text).toLowerCase();
  if (!blob) return false;
  if (/\b(s\.?\s*l\.?\s*u\.?|s\.?\s*a\.?|slu|gmbh|llc|l\.?l\.?c\.?|inc\.?|s\.?r\.?l\.?|sca|seurakunta|a\/s|b\.?v\.?)\b/i.test(blob)) return true;
  if (/\b(fundaci[oó]n|foundation|integra|alstom|caranorte|oysergo|viajes|ingenier|habilitacion|isocreatives|understory|ceacapa|omya)\b/i.test(blob))
    return true;
  const tokens = nameTokens(blob);
  if (tokens.length >= 3 && !blob.includes(',')) {
    const corp = ['services', 'group', 'holding', 'capital', 'housing', 'properties', 'creative', 'facility', 'management'];
    if (corp.some((w) => blob.includes(w))) return true;
  }
  return false;
}

export function displayPerson(row) {
  if (!row) return '';
  return [clean(row['First Name']), clean(row['Last Name(*)']), clean(row['Second Last Name'])].filter(Boolean).join(' ');
}

export function rowTaxIds(row) {
  const ids = new Set();
  for (const f of ['Tax Identification Number', 'Document Number', 'Internal Guest Notes', 'Company Id']) {
    const raw = clean(row[f]);
    if (!raw || raw === '/') continue;
    for (const part of raw.split(/[|,;/]/)) {
      const n = normId(part);
      if (n.length >= 8 || /^[A-Z]\d{7,8}[A-Z0-9]?$/.test(n)) ids.add(n);
    }
  }
  return [...ids];
}

export function companyTaxIds(c) {
  const ids = new Set();
  for (const f of ['Tax ID Number', 'Additional Tax Identifier', 'Fiscal Identifier']) {
    const n = normId(c[f]);
    if (n.length >= 8) ids.add(n);
  }
  return [...ids];
}

export function scoreCompanyMatch(rows, company) {
  const signals = [];
  let tier = 'none';
  const labels = [];
  for (const r of rows) {
    if (r) labels.push(displayPerson(r), clean(r['Partner Company']), clean(r['Company Id']));
  }
  const cIds = companyTaxIds(company);
  for (const r of rows) {
    if (!r) continue;
    for (const hi of rowTaxIds(r)) {
      for (const ci of cIds) {
        if (hi === ci || hi.includes(ci) || ci.includes(hi)) {
          signals.push(`tax_id:${hi}`);
          tier = 'strong';
        }
      }
    }
    const hEmail = normEmail(r.Email);
    const cEmail = normEmail(company['Invoicing Email']);
    if (hEmail && cEmail && hEmail === cEmail) {
      signals.push(`email:${hEmail}`);
      if (tier === 'none') tier = 'medium';
    }
  }
  const cn = companyNameTokens(company['Company Name(*)']);
  const cnNorm = normName(company['Company Name(*)']);
  for (const lab of labels) {
    const hn = nameTokens(lab);
    const hnNorm = normName(lab);
    if (cnNorm && hnNorm && (cnNorm.includes(hnNorm) || hnNorm.includes(cnNorm))) {
      signals.push('company_name_substring');
      if (tier === 'none') tier = 'medium';
    } else if (jaccard(cn, hn) >= 0.45) {
      signals.push(`company_name_jaccard:${jaccard(cn, hn).toFixed(2)}`);
      if (tier === 'none') tier = 'medium';
    }
  }
  const contact = nameTokens(company['Contact Person']);
  for (const r of rows) {
    if (!r) continue;
    const hn = nameTokens(displayPerson(r));
    const cj = jaccard(contact, hn);
    if (cj >= 0.5 && contact.length >= 2) {
      signals.push(`contact_person:${cj.toFixed(2)}`);
      if (tier === 'none') tier = 'weak';
    }
  }
  return { tier, signals: [...new Set(signals)] };
}

export function bestCompanyMatch(rows, companies) {
  let best = null;
  for (const co of companies) {
    const m = scoreCompanyMatch(rows, co);
    if (m.tier === 'none') continue;
    const score = m.signals.length + (m.tier === 'strong' ? 10 : m.tier === 'medium' ? 5 : 2);
    if (!best || score > best.score) best = { company: co, ...m, score };
  }
  return best;
}

/** Columns for Three_Way_Match + Mismatch_Names tables. */
export function companyFieldsForNc(c, s, h, companies) {
  const rows = [c, s, h];
  const nameLabels = [
    c ? displayPerson(c) : '',
    s ? displayPerson(s) : '',
    h ? displayPerson(h) : '',
    clean(c?.['Partner Company']),
    clean(c?.['Company Id']),
  ].filter(Boolean);

  const best = bestCompanyMatch(rows, companies);

  return {
    partner_company: clean(c?.['Partner Company']) || null,
    likely_company_label: nameLabels.some(isLikelyCompanyLabel),
    companies_match_tier: best ? best.tier : null,
    matched_company_id: best ? best.company.id : null,
    matched_company_name: best ? clean(best.company['Company Name(*)']) : null,
    companies_match_signals: best?.signals?.length ? best.signals.join(' | ') : null,
  };
}

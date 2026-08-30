/**
 * Field-level normalisation helpers. The source data is real-world messy:
 *  - dates arrive as JS Date-string dumps ("Sat Sep 27 2025 00:00:00 GMT+0000"),
 *    ISO strings, DD/MM/YYYY, Excel serials, or bare month names ("Dec")
 *  - numbers arrive with units ("5360 HA"), commas, blank strings, or "NONE"
 *  - text fields have inconsistent casing / whitespace / placeholder nulls
 *
 * Every helper returns a plain value (or null) and never throws.
 */
import type { ParsedDate, Quantity } from '../types.js';

const NULLISH = new Set([
  '',
  '-',
  '--',
  'n/a',
  'na',
  'none',
  'null',
  'nil',
  'tbd',
  'not applicable',
  'not available',
  '#n/a',
  '#value!',
  'unknown',
]);

export function cleanText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (NULLISH.has(s.toLowerCase())) return null;
  return s;
}

/** Title-case a normalised label. */
export function titleCase(v: unknown): string | null {
  const s = cleanText(v);
  if (!s) return null;
  const small = ['and', 'the', 'for', 'of'];
  return s
    .toLowerCase()
    .split(' ')
    .map((w) =>
      w.length <= 3 && /^[a-z]+$/.test(w) && small.includes(w)
        ? w
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function toParts(d: Date, raw: string): ParsedDate {
  const iso = d.toISOString().slice(0, 10);
  return { iso, monthKey: iso.slice(0, 7), raw };
}

/**
 * Parse a messy date. Returns null only when the input is truly empty.
 */
export function parseDate(v: unknown): ParsedDate | null {
  if (v === null || v === undefined || v === '') return null;
  const raw = v instanceof Date ? v.toISOString() : String(v).trim();
  if (!raw || NULLISH.has(raw.toLowerCase())) return null;

  if (v instanceof Date && !Number.isNaN(v.getTime())) return toParts(v, raw);

  // Excel serial number
  if (/^\d{4,6}(\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20000 && serial < 90000) {
      const ms = Math.round((serial - 25569) * 86400 * 1000);
      return toParts(new Date(ms), raw);
    }
  }

  // Bare month name -> keep monthName only
  const bareMonth = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (MONTHS[bareMonth] !== undefined) {
    return { iso: null, monthKey: null, monthName: titleCase(raw), raw };
  }

  // "Mon YYYY" / "Mon-YY" -> month precision
  const mY = raw.match(/^([A-Za-z]{3,4})[\s\-/']*(\d{2,4})$/);
  if (mY && MONTHS[mY[1].toLowerCase()] !== undefined) {
    let year = Number(mY[2]);
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, MONTHS[mY[1].toLowerCase()], 1));
    return { ...toParts(d, raw), iso: null };
  }

  // DD/MM/YYYY or DD-MM-YYYY (assume day-first, common in IN data)
  const dmy = raw.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let d = Number(dmy[1]);
    let m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += 2000;
    if (m > 12 && d <= 12) [d, m] = [m, d];
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (!Number.isNaN(dt.getTime())) return toParts(dt, raw);
  }

  // Fallback: let JS try (handles ISO + "Sat Sep 27 2025 ..." dumps)
  const dt = new Date(raw);
  if (!Number.isNaN(dt.getTime())) return toParts(dt, raw);

  return { iso: null, monthKey: null, raw, unparseable: true };
}

/** Parse a possibly-unit-tagged / comma-formatted number. Returns number|null. */
export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s || NULLISH.has(s.toLowerCase())) return null;
  s = s
    .replace(/[₹$,]/g, '')
    .replace(/\s*(ha|acre|acres|km|sq\.?\s?km|units?|nos?\.?|kms)\b/gi, '')
    .trim()
    .replace(/,/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Keep both the parsed number and the original string (units carry meaning). */
export function parseQuantity(v: unknown): Quantity {
  return { value: parseNumber(v), raw: cleanText(v) };
}

// ---- Domain-specific normalisation -----------------------------------------

const SECTOR_CANON: { canon: string; match: RegExp }[] = [
  { canon: 'Renewables', match: /renew|solar|wind|green energy/i },
  { canon: 'Power & Transmission', match: /power\s*line|powerline|transmission|grid|substation/i },
  { canon: 'Mining', match: /mining|mine|mineral|coal|quarry/i },
  { canon: 'Railways', match: /rail(way)?s?|metro|transit/i },
  { canon: 'Construction', match: /construct|infra(structure)?|real estate|building/i },
  { canon: 'Manufacturing', match: /manufactur|factory|industrial plant/i },
  { canon: 'Aviation', match: /aviation|airport|airline/i },
  { canon: 'Security & Surveillance', match: /security|surveillance|defen[cs]e/i },
  { canon: 'DSP', match: /^dsp$/i },
  { canon: 'Tender', match: /^tender/i },
  { canon: 'Others', match: /^other|^others$|misc/i },
];

export interface NormalizedSector {
  sector: string | null;
  raw: string | null;
  energy: boolean;
}

/** Canonical sector + whether it belongs to the broad "energy" umbrella. */
export function normalizeSector(v: unknown): NormalizedSector {
  const s = cleanText(v);
  if (!s) return { sector: null, raw: null, energy: false };
  const hit = SECTOR_CANON.find((c) => c.match.test(s));
  const sector = hit ? hit.canon : titleCase(s);
  const energy = sector === 'Renewables' || sector === 'Power & Transmission';
  return { sector, raw: s, energy };
}

const DEAL_STATUS_CANON: { canon: string; match: RegExp }[] = [
  { canon: 'Won', match: /won|closed won|success/i },
  { canon: 'Lost', match: /lost|dead|closed lost|dropped/i },
  { canon: 'On Hold', match: /hold|paused|stall/i },
  { canon: 'Open', match: /open|active|in progress|pipeline/i },
];

export function normalizeDealStatus(v: unknown): { status: string | null; raw: string | null } {
  const s = cleanText(v);
  if (!s) return { status: null, raw: null };
  const hit = DEAL_STATUS_CANON.find((c) => c.match.test(s));
  return { status: hit ? hit.canon : titleCase(s), raw: s };
}

export interface ParsedStage {
  stage: string | null;
  code: string | null;
  name: string | null;
  rank: number | null;
}

/** Deal stage like "E. Proposal/Commercials Sent" -> {code:'E', name:'...', rank:5}. */
export function parseDealStage(v: unknown): ParsedStage {
  const s = cleanText(v);
  if (!s) return { stage: null, code: null, name: null, rank: null };
  const m = s.match(/^([A-Za-z])[.)]\s*(.+)$/);
  if (m) {
    const code = m[1].toUpperCase();
    return { stage: s, code, name: titleCase(m[2]), rank: code.charCodeAt(0) - 64 };
  }
  return { stage: s, code: null, name: titleCase(s), rank: null };
}

const PROBABILITY_PCT: Record<string, number> = { high: 0.8, medium: 0.5, med: 0.5, low: 0.2 };

export function normalizeProbability(v: unknown): { label: string | null; pct: number | null } {
  const s = cleanText(v);
  if (!s) return { label: null, pct: null };
  const key = s.toLowerCase();
  if (PROBABILITY_PCT[key] !== undefined) return { label: titleCase(s), pct: PROBABILITY_PCT[key] };
  const asNum = parseNumber(s);
  if (asNum !== null) {
    const pct = asNum > 1 ? asNum / 100 : asNum;
    return { label: `${Math.round(pct * 100)}%`, pct };
  }
  return { label: titleCase(s), pct: null };
}

/** Detect if a row is actually a stray repeated header row from the source sheet. */
export function looksLikeHeaderRow(
  record: Record<string, unknown>,
  headerTokens: string[],
): boolean {
  const values = Object.values(record).map((x) => cleanText(x)?.toLowerCase());
  let hits = 0;
  for (const tok of headerTokens) {
    if (values.includes(tok.toLowerCase())) hits += 1;
  }
  return hits >= Math.max(2, Math.ceil(headerTokens.length * 0.4));
}

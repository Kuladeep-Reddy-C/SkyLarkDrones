import { describe, it, expect } from 'vitest';
import {
  cleanText,
  titleCase,
  parseDate,
  parseNumber,
  parseQuantity,
  normalizeSector,
  normalizeDealStatus,
  parseDealStage,
  normalizeProbability,
  looksLikeHeaderRow,
} from './normalize.js';

describe('cleanText', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanText('  a   b ')).toBe('a b');
  });
  it('maps placeholder nulls to null', () => {
    for (const v of ['', 'N/A', 'none', '#N/A', '-', 'TBD']) expect(cleanText(v)).toBeNull();
  });
  it('passes real values through', () => {
    expect(cleanText('Renewables')).toBe('Renewables');
  });
});

describe('parseDate', () => {
  it('parses a JS Date-string dump', () => {
    expect(parseDate('Sat Sep 27 2025 00:00:00 GMT+0000 (Coordinated Universal Time)')?.iso).toBe(
      '2025-09-27',
    );
  });
  it('parses ISO', () => {
    const d = parseDate('2026-03-20');
    expect(d?.iso).toBe('2026-03-20');
    expect(d?.monthKey).toBe('2026-03');
  });
  it('parses day-first DD/MM/YYYY', () => {
    expect(parseDate('05/11/2025')?.iso).toBe('2025-11-05');
  });
  it('keeps a bare month name without an iso date', () => {
    const d = parseDate('Dec');
    expect(d?.iso).toBeNull();
    expect(d?.monthName).toBe('Dec');
  });
  it('flags an unparseable string but does not throw', () => {
    const d = parseDate('sometime next year');
    expect(d?.iso).toBeNull();
    expect(d?.unparseable).toBe(true);
  });
  it('returns null only for empty input', () => {
    expect(parseDate('')).toBeNull();
    expect(parseDate(null)).toBeNull();
  });
});

describe('parseNumber / parseQuantity', () => {
  it('strips currency, commas and units', () => {
    expect(parseNumber('₹1,23,456')).toBe(123456);
    expect(parseNumber('5360 HA')).toBe(5360);
  });
  it('keeps float precision', () => {
    expect(parseNumber('2984097.36')).toBeCloseTo(2984097.36);
  });
  it('returns null for blanks / NONE', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('NONE')).toBeNull();
  });
  it('parseQuantity keeps the raw string alongside the number', () => {
    expect(parseQuantity('5360 HA')).toEqual({ value: 5360, raw: '5360 HA' });
  });
});

describe('domain normalisers', () => {
  it('canonicalises sectors and flags the energy umbrella', () => {
    expect(normalizeSector('Powerline')).toMatchObject({
      sector: 'Power & Transmission',
      energy: true,
    });
    expect(normalizeSector('Renewables')).toMatchObject({ sector: 'Renewables', energy: true });
    expect(normalizeSector('Mining')).toMatchObject({ energy: false });
  });
  it('maps "Dead" deal status to Lost', () => {
    expect(normalizeDealStatus('Dead').status).toBe('Lost');
    expect(normalizeDealStatus('Won').status).toBe('Won');
  });
  it('parses a lettered deal stage into code + rank', () => {
    expect(parseDealStage('E. Proposal/Commercials Sent')).toMatchObject({ code: 'E', rank: 5 });
  });
  it('maps probability labels to a pct', () => {
    expect(normalizeProbability('High').pct).toBe(0.8);
    expect(normalizeProbability('Low').pct).toBe(0.2);
    expect(normalizeProbability('').pct).toBeNull();
  });
  it('titleCase keeps small words lower', () => {
    expect(titleCase('nature of work')).toBe('Nature of Work');
  });
});

describe('looksLikeHeaderRow', () => {
  it('detects a stray repeated header row', () => {
    const rec = { 'Deal Name': 'Deal Name', 'Owner code': 'Owner code' };
    expect(looksLikeHeaderRow(rec, ['Deal Name', 'Owner code', 'Client Code'])).toBe(true);
  });
  it('passes a real data row', () => {
    const rec = { 'Deal Name': 'Naruto', 'Owner code': 'OWNER_001' };
    expect(looksLikeHeaderRow(rec, ['Deal Name', 'Owner code', 'Client Code'])).toBe(false);
  });
});

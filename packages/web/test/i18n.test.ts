import { afterEach, describe, expect, it } from 'vitest';
import { DICTIONARY, LANGS, formatNumber, local, setLang, t, type Key } from '../src/i18n.ts';

const placeholders = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string).sort();

describe('interface dictionary (R-6, E-7)', () => {
  const keys = Object.keys(DICTIONARY.en) as Key[];

  it('has the same keys in both languages', () => {
    expect(Object.keys(DICTIONARY.de).sort()).toEqual([...keys].sort());
  });

  it('has no empty text', () => {
    for (const lang of LANGS) for (const key of keys) expect(DICTIONARY[lang][key].trim(), `${lang}.${key}`).not.toBe('');
  });

  it('uses the same placeholders in both languages', () => {
    for (const key of keys) expect(placeholders(DICTIONARY.de[key]), key).toEqual(placeholders(DICTIONARY.en[key]));
  });

  it('has a singular form only together with its plural form', () => {
    for (const key of keys.filter((k) => k.endsWith('.one'))) expect(keys).toContain(key.slice(0, -4));
  });

  it('has a label for every fact category of the core', async () => {
    const { FACT_CATEGORIES, NOTICE_KINDS } = await import('@repr-werkbank/core');
    for (const c of FACT_CATEGORIES) expect(keys).toContain(`cat.${c}`);
    for (const k of NOTICE_KINDS) expect(keys).toContain(`notices.kind.${k}`);
  });
});

describe('lookup', () => {
  afterEach(() => setLang('en'));

  it('defaults to English', () => {
    expect(t('header.load')).toBe('Load');
  });

  it('switches the language', () => {
    setLang('de');
    expect(t('header.load')).toBe('Laden');
    expect(local({ en: 'a', de: 'b' })).toBe('b');
  });

  it('fills placeholders and picks the singular form for n = 1', () => {
    expect(t('figures.lines', { n: 1 })).toBe('1 line');
    expect(t('figures.lines', { n: 156 })).toBe('156 lines');
    expect(t('figures.tokens', { n: 2590 })).toBe('2,590 tokens');
    setLang('de');
    expect(t('figures.tokens', { n: 2590 })).toBe('2.590 Tokens');
  });

  it('formats numbers by language, for display only', () => {
    expect(formatNumber(1234.5, 1)).toBe('1,234.5');
    setLang('de');
    expect(formatNumber(1234.5, 1)).toBe('1.234,5');
  });
});

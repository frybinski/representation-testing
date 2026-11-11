import { describe, expect, it } from 'vitest';
import { STORAGE_KEY, defaultState, loadState, sanitizeState, saveState, type StorageLike, type UiState } from '../src/state.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

const sample: UiState = {
  lang: 'de',
  scheme: 'dark',
  views: ['json', 'mermaid'],
  wrap: [true, false],
  options: { verbalization: { language: 'de', showIdentifiers: true }, 'structure-report': { maxStates: 500000 } },
  exportSteps: ['verbalization', 'json'],
};

describe('persistence of the UI state (NF-05)', () => {
  it('round-trips through storage', () => {
    const storage = new MemoryStorage();
    saveState(storage, sample);
    expect(loadState(storage)).toEqual(sample);
    expect(storage.data.has(STORAGE_KEY)).toBe(true);
  });

  it('does not store the model or the open lower tab', () => {
    const storage = new MemoryStorage();
    saveState(storage, sample);
    expect(Object.keys(JSON.parse(storage.data.get(STORAGE_KEY) ?? '{}') as object).sort()).toEqual(['exportSteps', 'lang', 'options', 'scheme', 'views', 'wrap']);
  });

  it('falls back to the default without storage, with nothing stored, and with broken data', () => {
    expect(loadState(null)).toEqual(defaultState());
    expect(loadState(new MemoryStorage())).toEqual(defaultState());
    const broken = new MemoryStorage();
    broken.setItem(STORAGE_KEY, '{not json');
    expect(loadState(broken)).toEqual(defaultState());
  });

  it('survives a storage that throws', () => {
    const throwing: StorageLike = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(loadState(throwing)).toEqual(defaultState());
    expect(() => saveState(throwing, sample)).not.toThrow();
  });

  it('defaults to English, system scheme, original and verbalization', () => {
    expect(defaultState()).toMatchObject({ lang: 'en', scheme: null, views: ['original', 'verbalization'] });
  });

  it('replaces every unusable value by its default', () => {
    const s = sanitizeState({ lang: 'fr', scheme: 'pink', views: ['x'], wrap: 'yes', options: { a: 5, b: { k: { nested: 1 }, ok: 1 } }, exportSteps: [1] });
    expect(s).toEqual({ ...defaultState(), options: { b: { ok: 1 } } });
    expect(sanitizeState(null)).toEqual(defaultState());
    expect(sanitizeState([])).toEqual(defaultState());
  });
});

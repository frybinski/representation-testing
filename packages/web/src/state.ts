/**
 * UI state that is remembered between visits (NF-05, plan 3.4): language, colour scheme, the representation of each view, the options of
 * the generators, the wrap setting and the composition of the export. The model and the open lower tab are not stored (UI-02 wants the
 * collapsed base state on every open). Storage can be missing or throw (private window, blocked site data): every access is wrapped and
 * the page works without it.
 */
import type { OptionValues } from '@repr-werkbank/core';
import { isLang, type Lang } from './i18n.ts';

export const STORAGE_KEY = 'repr-werkbank:ui:v1';

export type SchemeChoice = 'light' | 'dark' | null;

export interface UiState {
  lang: Lang;
  /** Null: follow the system setting. */
  scheme: SchemeChoice;
  /** Generator id shown in view A and in view B. */
  views: [string, string];
  /** Wrap long lines in text view A and B. */
  wrap: [boolean, boolean];
  /** Only the options that differ from the default of the generator, per generator id. */
  options: Record<string, OptionValues>;
  /** Generator ids of the prompt block in order; null until the person has changed the list (then the two views' text representations). */
  exportSteps: string[] | null;
  /** Prompt block with the header lines (FA-71). */
  exportHeader: boolean;
}

export const DEFAULT_VIEWS: [string, string] = ['original', 'verbalization'];

export function defaultState(): UiState {
  return { lang: 'en', scheme: null, views: [...DEFAULT_VIEWS], wrap: [false, false], options: {}, exportSteps: null, exportHeader: true };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Takes whatever was stored and returns a valid state; everything unusable falls back to the default. Never throws. */
export function sanitizeState(raw: unknown): UiState {
  const state = defaultState();
  if (!isRecord(raw)) return state;
  if (isLang(raw['lang'])) state.lang = raw['lang'];
  if (raw['scheme'] === 'light' || raw['scheme'] === 'dark') state.scheme = raw['scheme'];
  const views = raw['views'];
  if (Array.isArray(views) && views.length === 2 && views.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 64)) state.views = [views[0] as string, views[1] as string];
  const wrap = raw['wrap'];
  if (Array.isArray(wrap) && wrap.length === 2 && wrap.every((v) => typeof v === 'boolean')) state.wrap = [wrap[0] as boolean, wrap[1] as boolean];
  const options = raw['options'];
  if (isRecord(options)) {
    for (const [id, values] of Object.entries(options)) {
      if (!isRecord(values)) continue;
      const clean: OptionValues = {};
      for (const [key, v] of Object.entries(values)) if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') clean[key] = v;
      if (Object.keys(clean).length > 0) state.options[id] = clean;
    }
  }
  const steps = raw['exportSteps'];
  if (Array.isArray(steps) && steps.length <= 32 && steps.every((v) => typeof v === 'string' && v.length > 0 && v.length <= 64)) state.exportSteps = [...(steps as string[])];
  if (typeof raw['exportHeader'] === 'boolean') state.exportHeader = raw['exportHeader'];
  return state;
}

/** Minimal part of `Storage` that is used, so that tests can pass a fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadState(storage: StorageLike | null): UiState {
  if (!storage) return defaultState();
  try {
    const text = storage.getItem(STORAGE_KEY);
    return text === null ? defaultState() : sanitizeState(JSON.parse(text));
  } catch {
    return defaultState();
  }
}

export function saveState(storage: StorageLike | null, state: UiState): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The page works without persistence.
  }
}

/** `window.localStorage`, or null when the accessor throws (blocked site data). */
export function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

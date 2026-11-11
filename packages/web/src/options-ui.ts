/**
 * Option widgets built from the `OptionSpec` of a generator (FA-63, §7): a boolean is a switch, a choice a selection, an integer a
 * bounded number field. Nothing here knows a generator; a new option appears without a change in this package.
 */
import type { OptionSpec, OptionValue, OptionValues } from '@repr-werkbank/core';
import { el } from './dom.ts';
import { local } from './i18n.ts';
import { icon } from './icons.ts';

export interface OptionFieldsConfig {
  specs: readonly OptionSpec[];
  /** Effective values: every key of every spec has a value. */
  values: OptionValues;
  /** Prefix that makes the element ids unique on the page. */
  idPrefix: string;
  /** Called with a valid value only. */
  onChange(key: string, value: OptionValue): void;
}

/** Parses the text of a number field; null when it is not an integer in the bounds of the spec. */
export function parseInteger(text: string, min: number, max: number): number | null {
  if (!/^-?\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

export function optionFields(cfg: OptionFieldsConfig): HTMLElement {
  const list = el('div', { class: 'options' });
  for (const spec of cfg.specs) {
    const id = `${cfg.idPrefix}-${spec.key}`;
    const current = cfg.values[spec.key] ?? spec.default;
    const descId = `${id}-desc`;
    const description = el('p', { class: 'option-desc', id: descId }, local(spec.description));
    let control: HTMLElement;
    if (spec.type === 'boolean') {
      const input = el('input', { type: 'checkbox', role: 'switch', id, 'aria-describedby': descId, ...(current === true && { checked: true }) });
      input.checked = current === true;
      input.addEventListener('change', () => cfg.onChange(spec.key, input.checked));
      control = el('label', { class: 'option-row switch', for: id }, el('span', { class: 'option-label' }, local(spec.label)), input, el('span', { class: 'switch-track', 'aria-hidden': 'true' }));
    } else if (spec.type === 'choice') {
      const select = el('select', { class: 'select', id, 'aria-describedby': descId });
      for (const v of spec.values) select.append(el('option', { value: v.value }, local(v.label)));
      select.value = String(current);
      select.addEventListener('change', () => cfg.onChange(spec.key, select.value));
      control = el('div', { class: 'option-row' }, el('label', { class: 'option-label', for: id }, local(spec.label)), el('span', { class: 'select-wrap' }, select, icon('chevron')));
    } else {
      const input = el('input', { class: 'number', type: 'number', id, inputmode: 'numeric', min: String(spec.min), max: String(spec.max), step: '1', 'aria-describedby': descId });
      input.value = String(current);
      input.addEventListener('input', () => {
        const n = parseInteger(input.value, spec.min, spec.max);
        if (n === null) {
          input.setAttribute('aria-invalid', 'true');
          return;
        }
        input.removeAttribute('aria-invalid');
        cfg.onChange(spec.key, n);
      });
      control = el('div', { class: 'option-row' }, el('label', { class: 'option-label', for: id }, local(spec.label)), input);
    }
    list.append(el('div', { class: 'option' }, control, description));
  }
  return list;
}

/** `values` filled with the defaults of `specs`. */
export function effectiveValues(specs: readonly OptionSpec[], overrides: OptionValues | undefined): OptionValues {
  const out: OptionValues = {};
  for (const s of specs) out[s.key] = overrides !== undefined && Object.hasOwn(overrides, s.key) ? (overrides[s.key] as OptionValue) : s.default;
  return out;
}

/** Sets or clears one option in the stored overrides: a value equal to the default is removed, so only differences are kept. */
export function withOption(options: Record<string, OptionValues>, id: string, spec: OptionSpec, value: OptionValue): Record<string, OptionValues> {
  const next: Record<string, OptionValues> = { ...options };
  const own: OptionValues = { ...(next[id] ?? {}) };
  if (value === spec.default) delete own[spec.key];
  else own[spec.key] = value;
  if (Object.keys(own).length === 0) delete next[id];
  else next[id] = own;
  return next;
}

/** Keeps only the options that exist and are valid for the specs of each generator; stored values from an older version cannot break a run. */
export function validOptions(specsOf: (id: string) => readonly OptionSpec[] | undefined, stored: Record<string, OptionValues>): Record<string, OptionValues> {
  const out: Record<string, OptionValues> = {};
  for (const [id, values] of Object.entries(stored)) {
    const specs = specsOf(id);
    if (!specs) continue;
    const clean: OptionValues = {};
    for (const spec of specs) {
      const v = values[spec.key];
      if (v === undefined) continue;
      const ok =
        spec.type === 'boolean' ? typeof v === 'boolean' : spec.type === 'choice' ? typeof v === 'string' && spec.values.some((c) => c.value === v) : typeof v === 'number' && Number.isInteger(v) && v >= spec.min && v <= spec.max;
      if (ok && v !== spec.default) clean[spec.key] = v;
    }
    if (Object.keys(clean).length > 0) out[id] = clean;
  }
  return out;
}

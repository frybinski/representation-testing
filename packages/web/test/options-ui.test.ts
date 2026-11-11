// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, type OptionSpec, type OptionValue } from '@repr-werkbank/core';
import { setLang } from '../src/i18n.ts';
import { effectiveValues, optionFields, parseInteger, validOptions, withOption } from '../src/options-ui.ts';

const specs: OptionSpec[] = [
  { type: 'boolean', key: 'flag', label: { en: 'Flag', de: 'Schalter' }, description: { en: 'A flag.', de: 'Ein Schalter.' }, default: false },
  { type: 'choice', key: 'pick', label: { en: 'Pick', de: 'Wahl' }, description: { en: 'One of two.', de: 'Eins von zwei.' }, default: 'a', values: [{ value: 'a', label: { en: 'Alpha', de: 'Alfa' } }, { value: 'b', label: { en: 'Beta', de: 'Beta' } }] },
  { type: 'integer', key: 'count', label: { en: 'Count', de: 'Anzahl' }, description: { en: 'A number.', de: 'Eine Zahl.' }, default: 5, min: 1, max: 9 },
];

function build(values = effectiveValues(specs, undefined)): { root: HTMLElement; changes: [string, OptionValue][] } {
  const changes: [string, OptionValue][] = [];
  const root = optionFields({ specs, values, idPrefix: 't', onChange: (k, v) => changes.push([k, v]) });
  document.body.replaceChildren(root);
  return { root, changes };
}

describe('option widgets from OptionSpec (FA-63)', () => {
  it('make a switch, a selection and a bounded number field', () => {
    const { root } = build();
    const sw = root.querySelector<HTMLInputElement>('#t-flag');
    expect(sw?.type).toBe('checkbox');
    expect(sw?.getAttribute('role')).toBe('switch');
    const select = root.querySelector<HTMLSelectElement>('#t-pick');
    expect([...(select?.options ?? [])].map((o) => [o.value, o.textContent])).toEqual([['a', 'Alpha'], ['b', 'Beta']]);
    const num = root.querySelector<HTMLInputElement>('#t-count');
    expect([num?.type, num?.min, num?.max, num?.value]).toEqual(['number', '1', '9', '5']);
  });

  it('label every control and describe it', () => {
    const { root } = build();
    for (const key of ['flag', 'pick', 'count']) {
      expect(root.querySelector(`label[for="t-${key}"]`), key).not.toBeNull();
      expect(root.querySelector(`#t-${key}`)?.getAttribute('aria-describedby')).toBe(`t-${key}-desc`);
      expect(root.querySelector(`#t-${key}-desc`)?.textContent).not.toBe('');
    }
  });

  it('show the effective values', () => {
    const { root } = build({ flag: true, pick: 'b', count: 7 });
    expect(root.querySelector<HTMLInputElement>('#t-flag')?.checked).toBe(true);
    expect(root.querySelector<HTMLSelectElement>('#t-pick')?.value).toBe('b');
    expect(root.querySelector<HTMLInputElement>('#t-count')?.value).toBe('7');
  });

  it('report changes with typed values', () => {
    const { root, changes } = build();
    const sw = root.querySelector<HTMLInputElement>('#t-flag') as HTMLInputElement;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    const select = root.querySelector<HTMLSelectElement>('#t-pick') as HTMLSelectElement;
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    const num = root.querySelector<HTMLInputElement>('#t-count') as HTMLInputElement;
    num.value = '8';
    num.dispatchEvent(new Event('input'));
    expect(changes).toEqual([['flag', true], ['pick', 'b'], ['count', 8]]);
  });

  it('do not report an integer outside the bounds, and mark the field', () => {
    const { root, changes } = build();
    const num = root.querySelector<HTMLInputElement>('#t-count') as HTMLInputElement;
    for (const bad of ['0', '10', '1.5', 'abc', '']) {
      num.value = bad;
      num.dispatchEvent(new Event('input'));
      expect(num.getAttribute('aria-invalid'), bad).toBe('true');
    }
    num.value = '3';
    num.dispatchEvent(new Event('input'));
    expect(num.hasAttribute('aria-invalid')).toBe(false);
    expect(changes).toEqual([['count', 3]]);
  });

  it('use the language of the interface', () => {
    setLang('de');
    const { root } = build();
    setLang('en');
    expect(root.querySelector('label[for="t-pick"]')?.textContent).toBe('Wahl');
    expect(root.querySelector('#t-pick option')?.textContent).toBe('Alfa');
  });

  it('are built for every option of every generator in the registry', () => {
    for (const def of createDefaultRegistry().list()) {
      const root = optionFields({ specs: def.options, values: effectiveValues(def.options, undefined), idPrefix: def.id, onChange: () => undefined });
      expect(root.querySelectorAll('.option').length, def.id).toBe(def.options.length);
    }
  });
});

describe('option state', () => {
  it('parses integers strictly', () => {
    expect(parseInteger(' 7 ', 1, 9)).toBe(7);
    expect(parseInteger('-3', -5, 5)).toBe(-3);
    expect(parseInteger('1e2', 1, 1000)).toBeNull();
    expect(parseInteger('10', 1, 9)).toBeNull();
  });

  it('stores only differences from the default', () => {
    const [flag, , count] = specs as [OptionSpec, OptionSpec, OptionSpec];
    let o = withOption({}, 'g', flag, true);
    expect(o).toEqual({ g: { flag: true } });
    o = withOption(o, 'g', count, 7);
    expect(o).toEqual({ g: { flag: true, count: 7 } });
    o = withOption(o, 'g', flag, false);
    o = withOption(o, 'g', count, 5);
    expect(o).toEqual({});
  });

  it('drops stored values that are unknown, invalid or the default', () => {
    const clean = validOptions((id) => (id === 'g' ? specs : undefined), {
      g: { flag: true, pick: 'z', count: 99, other: 1, extra: 'x' },
      gone: { flag: true },
    });
    expect(clean).toEqual({ g: { flag: true } });
    expect(validOptions((id) => (id === 'g' ? specs : undefined), { g: { count: 5 } })).toEqual({});
  });
});

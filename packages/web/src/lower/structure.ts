import { el } from '../dom.ts';
import { t } from '../i18n.ts';

/** Where the structure report is (3.1): waiting for the first result, being computed (the soundness search), done, or cancelled. */
export type StructureState = 'none' | 'running' | 'done' | 'cancelled';

export interface StructureInput {
  state: StructureState;
  /** Text of the report in the language of its option, when done. */
  text: string | null;
  /** Options of the additions, as built by `optionFields`. */
  options: HTMLElement | null;
  onCancel: () => void;
  onAgain: () => void;
  onSave: () => void;
  onCopy: () => void;
}

export function renderStructure(input: StructureInput): HTMLElement {
  const parts: Node[] = [];
  const button = (label: string, action: () => void, primary = false): HTMLButtonElement => {
    const b = el('button', { type: 'button', class: primary ? 'push-button is-primary' : 'push-button' }, label);
    b.addEventListener('click', action);
    return b;
  };
  if (input.state === 'running') {
    parts.push(el('div', { class: 'structure-state', role: 'status' }, el('p', {}, t('structure.computing')), button(t('structure.cancel'), input.onCancel)));
  } else if (input.state === 'cancelled') {
    parts.push(
      el(
        'div',
        { class: 'structure-state', role: 'status' },
        el('p', { class: 'strong' }, t('structure.cancelled')),
        el('p', { class: 'muted' }, t('structure.cancelledHint')),
        button(t('structure.again'), input.onAgain, true),
      ),
    );
  } else if (input.state === 'done' && input.text !== null) {
    parts.push(el('div', { class: 'structure-actions' }, button(t('structure.copy'), input.onCopy), button(t('structure.save'), input.onSave)));
    parts.push(el('pre', { class: 'report', tabindex: '0' }, input.text));
  } else {
    parts.push(el('p', { class: 'muted' }, t('structure.waiting')));
  }
  if (input.options) parts.push(el('div', { class: 'structure-options' }, el('h2', { class: 'popover-title' }, t('structure.options')), input.options));
  return el('div', { class: 'structure' }, ...parts);
}

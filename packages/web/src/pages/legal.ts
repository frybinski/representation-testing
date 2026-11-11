import { el } from '../dom.ts';
import { t } from '../i18n.ts';
import { pageFrame } from './page.ts';

/** The one placeholder of the public site (E-6): the legal and privacy notice follow, after the requirements of the KIT. */
export function renderLegal(): HTMLElement {
  return pageFrame(
    t('legal.title'),
    el('p', { class: 'placeholder', role: 'note' }, el('strong', {}, t('legal.marker')), ' ', t('legal.text')),
  );
}

import { el } from '../dom.ts';
import { t } from '../i18n.ts';
import { hrefOf } from '../router.ts';

/** The frame of a page (UI-01: About, Formats and Legal are pages of their own): a way back, the heading, the content. */
export function pageFrame(title: string, ...content: Node[]): HTMLElement {
  const heading = el('h1', { class: 'page-title', tabindex: '-1', id: 'page-title' }, title);
  const back = el('a', { class: 'page-back', href: hrefOf('workspace') }, t('page.back'));
  return el('article', { class: 'page-body' }, back, heading, ...content);
}

/** A section with a heading and paragraphs (text only, never markup). */
export function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return el('section', { class: 'page-section' }, el('h2', { class: 'page-heading' }, title), ...children.map((c) => (typeof c === 'string' ? el('p', {}, c) : c)));
}

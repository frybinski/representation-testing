import { el } from '../dom.ts';
import { t } from '../i18n.ts';

export type BundleAvailability = 'ready' | 'computing' | 'cancelled';

/**
 * The export tab of this stage: the bundle (FA-72). It is never offered while the structure report is missing, because a bundle
 * without it would differ from the command line tool's.
 */
export function renderExport(availability: BundleAvailability, onSave: () => void): HTMLElement {
  const save = el('button', { type: 'button', class: 'push-button is-primary', ...(availability !== 'ready' && { disabled: true }) }, t('export.bundleSave'));
  save.addEventListener('click', onSave);
  const reason = availability === 'computing' ? t('export.bundleComputing') : availability === 'cancelled' ? t('export.bundleCancelled') : null;
  return el(
    'div',
    { class: 'export' },
    el('h2', { class: 'popover-title' }, t('export.bundleTitle')),
    el('p', { class: 'muted' }, t('export.bundleText')),
    save,
    ...(reason ? [el('p', { class: 'muted', role: 'status' }, reason)] : []),
  );
}

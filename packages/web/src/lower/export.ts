import { el } from '../dom.ts';
import { t } from '../i18n.ts';
import { icon } from '../icons.ts';

export type BundleAvailability = 'ready' | 'computing' | 'cancelled';

/** One step of the prompt block as the list shows it. */
export interface ExportStep {
  id: string;
  name: string;
}

export interface PromptPreview {
  status: 'empty' | 'blocked' | 'loading' | 'ready' | 'error';
  /** Why there is no preview (blocked, error). */
  reason?: string;
  text?: string;
  /** Figures line of the block, with the tokenizer next to the count. */
  figures?: string;
  /** The note that the token count depends on the LLM (FA-42). */
  note?: string;
}

export interface ExportInput {
  steps: readonly ExportStep[];
  /** Representations that can still be added (every generator at most once, because options are per generator). */
  available: readonly ExportStep[];
  header: boolean;
  preview: PromptPreview;
  bundle: BundleAvailability;
}

export interface ExportHandlers {
  add(id: string): void;
  remove(index: number): void;
  move(index: number, delta: -1 | 1): void;
  setHeader(on: boolean): void;
  copy(): void;
  save(): void;
  saveBundle(): void;
}

/**
 * The export tab (FA-28, FA-71, FA-72): the prompt block composer and the bundle. The panel is built once and updated in place, so
 * that the focus stays where the person is while the list or the preview changes. All bytes come from the core: the preview is the
 * text of `promptBlock` made in the worker, the bundle is the worker's `serializeBundle`.
 */
export class ExportPanel {
  readonly root: HTMLElement;
  private readonly list = el('ol', { class: 'composer-list' });
  private readonly empty = el('p', { class: 'muted' });
  private readonly addSelect = el('select', { class: 'select', id: 'composer-add' });
  private readonly addLabel = el('label', { for: 'composer-add', class: 'option-label' });
  private readonly addButton = el('button', { type: 'button', class: 'push-button' });
  private readonly headerInput = el('input', { type: 'checkbox', role: 'switch', id: 'composer-header' });
  private readonly headerLabel = el('span', { class: 'option-label' });
  private readonly headerDesc = el('p', { class: 'option-desc', id: 'composer-header-desc' });
  private readonly title = el('h2', { class: 'popover-title' });
  private readonly intro = el('p', { class: 'muted' });
  private readonly previewTitle = el('h3', { class: 'composer-subtitle' });
  private readonly previewStatus = el('p', { class: 'muted', role: 'status' });
  private readonly pre = el('pre', { class: 'report preview', tabindex: '0', id: 'composer-preview' });
  private readonly figures = el('p', { class: 'figures-text composer-figures' });
  private readonly copyButton = el('button', { type: 'button', class: 'push-button' });
  private readonly saveButton = el('button', { type: 'button', class: 'push-button' });
  private readonly bundleTitle = el('h2', { class: 'popover-title' });
  private readonly bundleText = el('p', { class: 'muted' });
  private readonly bundleButton = el('button', { type: 'button', class: 'push-button is-primary' });
  private readonly bundleReason = el('p', { class: 'muted', role: 'status' });
  private readonly singles = el('p', { class: 'muted' });
  /** After a re-render the focus goes back to this control: `<action>:<index>`. */
  private refocus: string | null = null;

  constructor(private readonly handlers: ExportHandlers) {
    this.addButton.addEventListener('click', () => {
      if (this.addSelect.value !== '') this.handlers.add(this.addSelect.value);
    });
    this.headerInput.addEventListener('change', () => this.handlers.setHeader(this.headerInput.checked));
    this.copyButton.addEventListener('click', () => this.handlers.copy());
    this.saveButton.addEventListener('click', () => this.handlers.save());
    this.bundleButton.addEventListener('click', () => this.handlers.saveBundle());
    this.headerInput.setAttribute('aria-describedby', 'composer-header-desc');
    const controls = el(
      'div',
      { class: 'composer-controls' },
      this.title,
      this.intro,
      this.list,
      this.empty,
      el('div', { class: 'composer-add' }, this.addLabel, el('span', { class: 'select-wrap' }, this.addSelect, icon('chevron')), this.addButton),
      el('div', { class: 'option' }, el('label', { class: 'option-row switch', for: 'composer-header' }, this.headerLabel, this.headerInput, el('span', { class: 'switch-track', 'aria-hidden': 'true' })), this.headerDesc),
    );
    const preview = el('div', { class: 'composer-preview' }, this.previewTitle, this.previewStatus, this.pre, this.figures, el('div', { class: 'structure-actions' }, this.copyButton, this.saveButton));
    const bundle = el('div', { class: 'export-bundle' }, this.bundleTitle, this.bundleText, this.bundleButton, this.bundleReason, this.singles);
    this.root = el('div', { class: 'export' }, el('div', { class: 'composer' }, controls, preview), bundle);
  }

  /** Remembers the control to focus after the next update, for example the button that was just used to move an item. */
  focusAfterUpdate(action: 'up' | 'down' | 'remove' | 'add', index: number): void {
    this.refocus = `${action}:${index}`;
  }

  update(input: ExportInput): void {
    // Every update rebuilds the list; a control of it that has the focus (the person is pressing a button repeatedly) keeps it.
    const active = document.activeElement;
    if (this.refocus === null && active instanceof HTMLElement && this.list.contains(active) && active.dataset['action'] !== undefined) this.refocus = `${active.dataset['action']}:${active.dataset['index'] ?? ''}`;
    this.title.textContent = t('export.promptTitle');
    this.intro.textContent = t('export.promptText');
    this.list.setAttribute('aria-label', t('export.listLabel'));
    this.list.replaceChildren(...input.steps.map((step, i) => this.item(step, i, input.steps.length)));
    this.list.hidden = input.steps.length === 0;
    this.empty.hidden = input.steps.length > 0;
    this.empty.textContent = t('export.listEmpty');

    this.addLabel.textContent = t('export.addLabel');
    this.addSelect.replaceChildren(...input.available.map((a) => el('option', { value: a.id }, a.name)));
    this.addSelect.disabled = input.available.length === 0;
    this.addButton.disabled = input.available.length === 0;
    this.addButton.textContent = t('export.add');
    this.headerLabel.textContent = t('export.header');
    this.headerInput.checked = input.header;
    this.headerDesc.textContent = t('export.headerDesc');

    const p = input.preview;
    this.previewTitle.textContent = t('export.preview');
    this.previewStatus.hidden = p.status === 'ready';
    this.previewStatus.textContent = p.status === 'empty' ? t('export.previewEmpty') : p.status === 'loading' ? t('export.previewLoading') : (p.reason ?? '');
    this.pre.hidden = p.status !== 'ready' && p.status !== 'loading';
    this.pre.setAttribute('aria-label', t('export.previewLabel'));
    this.pre.setAttribute('aria-busy', String(p.status === 'loading'));
    // While a new text is made the last one stays visible (no flicker); the first time there is nothing.
    if (p.status === 'ready') this.pre.textContent = p.text ?? '';
    else if (p.status !== 'loading') this.pre.textContent = '';
    this.pre.hidden = this.pre.textContent === '';
    this.figures.hidden = p.status !== 'ready';
    this.figures.textContent = p.figures ?? '';
    this.figures.title = p.note ?? '';
    const ready = p.status === 'ready';
    this.copyButton.disabled = !ready;
    this.saveButton.disabled = !ready;
    this.copyButton.textContent = t('export.copy');
    this.saveButton.textContent = t('export.save');

    this.bundleTitle.textContent = t('export.bundleTitle');
    this.bundleText.textContent = t('export.bundleText');
    this.bundleButton.textContent = t('export.bundleSave');
    this.bundleButton.disabled = input.bundle !== 'ready';
    this.bundleReason.hidden = input.bundle === 'ready';
    this.bundleReason.textContent = input.bundle === 'computing' ? t('export.bundleComputing') : input.bundle === 'cancelled' ? t('export.bundleCancelled') : '';
    this.singles.textContent = t('export.singles');

    if (this.refocus) {
      const [action, index] = this.refocus.split(':') as [string, string];
      this.refocus = null;
      const target = this.root.querySelector<HTMLElement>(`[data-action="${action}"][data-index="${index}"]`) ?? (action === 'add' ? this.addSelect : null);
      (target && !(target as HTMLButtonElement).disabled ? target : this.root.querySelector<HTMLElement>('.composer-list button:not(:disabled)') ?? this.addSelect).focus();
    }
  }

  private item(step: ExportStep, i: number, count: number): HTMLElement {
    const button = (action: 'up' | 'down' | 'remove', label: string, glyph: 'up' | 'down' | 'close', disabled: boolean, run: () => void): HTMLButtonElement => {
      const b = el('button', { type: 'button', class: 'icon-button', 'data-action': action, 'data-index': String(i), 'aria-label': label, title: label, ...(disabled && { disabled: true }) });
      b.append(icon(glyph));
      b.addEventListener('click', run);
      return b;
    };
    return el(
      'li',
      { class: 'composer-item', 'data-step': step.id },
      el('span', { class: 'composer-name' }, step.name),
      el(
        'span',
        { class: 'composer-buttons' },
        button('up', t('export.moveUp', { name: step.name }), 'up', i === 0, () => {
          this.focusAfterUpdate(i - 1 === 0 ? 'down' : 'up', i - 1);
          this.handlers.move(i, -1);
        }),
        button('down', t('export.moveDown', { name: step.name }), 'down', i === count - 1, () => {
          this.focusAfterUpdate(i + 1 === count - 1 ? 'up' : 'down', i + 1);
          this.handlers.move(i, 1);
        }),
        button('remove', t('export.remove', { name: step.name }), 'close', false, () => {
          this.focusAfterUpdate('remove', Math.min(i, count - 2));
          this.handlers.remove(i);
        }),
      ),
    );
  }
}

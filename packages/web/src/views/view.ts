import type { GeneratorDefinition, GeneratorRegistry, OptionSpec, OptionValue, OptionValues } from '@repr-werkbank/core';
import { el } from '../dom.ts';
import { copyText, pngSizeAllowed, saveBlob, saveText, svgToPng } from '../download.ts';
import { formatNumber, local, t } from '../i18n.ts';
import { icon } from '../icons.ts';
import { effectiveValues, optionFields } from '../options-ui.ts';
import { attachPopover, type Popover } from '../popover.ts';
import type { RepresentationData } from '../protocol.ts';
import { languageOfMime } from '../syntax.ts';
import { DiagramView } from './diagram-view.ts';
import { buildCode } from './text-view.ts';

/** What a view needs to know about the loaded model. */
export interface ViewModel {
  representations: RepresentationData[];
  figures: { tokenizer: { name: string; implementation: string }; rows: ({ id: string; kind: 'text'; characters: number; lines: number; tokens: number; tokenizer: string } | { id: string; kind: 'image'; width: number; height: number; bytes: number })[] };
  /** Text alternative of the diagram in the interface language. */
  alt: string;
  /** Base name of the model file for the names of saved files. */
  baseName: string;
}

export interface ViewInput {
  selected: string;
  model: ViewModel | null;
  loading: boolean;
  wrap: boolean;
  /** Stored option overrides per generator id. */
  options: Record<string, OptionValues>;
}

export interface ViewCallbacks {
  onSelect(id: string): void;
  onOption(generatorId: string, spec: OptionSpec, value: OptionValue): void;
  onWrap(wrap: boolean): void;
  /** Says something to assistive technology (copied, saved). */
  announce(message: string): void;
}

const PNG_SCALES = [1, 2, 3, 4] as const;

/** One of the two views (UI-04): the bar with the representation select and three icon buttons, the content, the figures line. */
export class RepresentationView {
  readonly section: HTMLElement;
  readonly tab: HTMLButtonElement;

  private readonly select: HTMLSelectElement;
  private readonly content: HTMLElement;
  private readonly figures: HTMLElement;
  private readonly figuresText: HTMLElement;
  private readonly infoButton: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly optionsButton: HTMLButtonElement;
  private readonly optionsPopover: Popover;
  private readonly optionsPanel: HTMLElement;
  private readonly savePopover: Popover;
  private readonly savePanel: HTMLElement;
  private readonly copyButton: HTMLButtonElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly textScroll: HTMLElement;
  private readonly diagram = new DiagramView();
  private readonly altEl: HTMLElement;
  private readonly status: HTMLElement;

  private input: ViewInput | null = null;
  private shownText: string | null = null;
  private shownId: string | null = null;
  private optionsKey = '';
  private selectKey = '';
  private copyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly key: 'a' | 'b',
    private readonly registry: GeneratorRegistry,
    private readonly callbacks: ViewCallbacks,
  ) {
    const id = `view-${key}`;
    this.select = el('select', { class: 'select', id: `rep-${key}` });
    this.select.addEventListener('change', () => callbacks.onSelect(this.select.value));

    const optionsButton = el('button', { type: 'button', class: 'icon-button' });
    optionsButton.append(icon('options'));
    this.optionsButton = optionsButton;
    this.copyButton = el('button', { type: 'button', class: 'icon-button' });
    this.copyButton.append(icon('copy'));
    this.saveButton = el('button', { type: 'button', class: 'icon-button' });
    this.saveButton.append(icon('save'));

    const bar = el(
      'div',
      { class: 'bar' },
      el('span', { class: 'select-wrap' }, this.select, icon('chevron')),
      el('div', { class: 'bar-buttons' }, optionsButton, this.copyButton, this.saveButton),
    );

    this.optionsPanel = el('div', { class: 'popover', id: `${id}-options`, role: 'group' });
    this.optionsPopover = attachPopover(optionsButton, this.optionsPanel, () => this.buildOptions(true));
    this.savePanel = el('div', { class: 'popover popover-menu', id: `${id}-save`, role: 'group' });
    this.savePopover = attachPopover(this.saveButton, this.savePanel, () => this.buildSaveMenu());
    this.saveButton.addEventListener('click', () => {
      if (this.currentRep()?.kind === 'text') this.saveCurrentText();
    });
    this.copyButton.addEventListener('click', () => void this.copyCurrent());

    this.textScroll = el('div', { class: 'text-scroll', tabindex: '0', role: 'region' });
    this.altEl = el('div', { class: 'sr-only', id: `${id}-alt` });
    this.status = el('div', { class: 'view-status' });
    this.content = el('div', { class: 'view-content' }, this.textScroll, this.diagram.element, this.status, this.altEl);

    this.figuresText = el('span', { class: 'figures-text' });
    this.infoButton = el('button', { type: 'button', class: 'info-button', 'aria-expanded': 'false', 'aria-controls': `${id}-note` });
    this.infoButton.append(icon('info'));
    this.note = el('p', { class: 'figures-note', id: `${id}-note`, hidden: true });
    this.infoButton.addEventListener('click', () => {
      this.note.hidden = !this.note.hidden;
      this.infoButton.setAttribute('aria-expanded', String(!this.note.hidden));
    });
    this.figures = el('div', { class: 'figures' }, el('p', { class: 'figures-row' }, this.figuresText, this.infoButton), this.note);

    this.section = el('section', { class: 'view', id }, bar, this.content, this.figures, this.optionsPanel, this.savePanel);
    this.tab = el('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${key}`, 'aria-controls': id });
  }

  private get viewName(): string {
    return t(this.key === 'a' ? 'view.a' : 'view.b');
  }

  private currentRep(): RepresentationData | undefined {
    const input = this.input;
    return input?.model?.representations.find((r) => r.id === input.selected);
  }

  private def(id: string): GeneratorDefinition | undefined {
    return this.registry.list().find((d) => d.id === id);
  }

  render(input: ViewInput): void {
    this.input = input;
    const rep = this.currentRep();
    const def = this.def(input.selected);

    // Representation select: the representations of the model; before a model exists only the stored choice.
    const ids = input.model ? input.model.representations.map((r) => r.id) : [input.selected];
    const key = ids.map((id) => `${id}:${local((this.def(id)?.name) ?? { en: id, de: id })}`).join('|');
    if (key !== this.selectKey) {
      this.select.replaceChildren(...ids.map((id) => el('option', { value: id }, local(this.def(id)?.name ?? { en: id, de: id }))));
      this.selectKey = key;
    }
    this.select.value = input.selected;
    this.select.setAttribute('aria-label', t('view.representation', { view: this.viewName }));

    const optionsButton = this.optionsButton;
    optionsButton.setAttribute('aria-label', t('view.options'));
    optionsButton.title = t('view.options');
    this.copyButton.setAttribute('aria-label', t('view.copy'));
    this.copyButton.title = t('view.copy');
    this.saveButton.setAttribute('aria-label', t('view.save'));
    this.saveButton.title = t('view.save');
    const isImage = rep?.kind === 'image';
    this.savePopover.setEnabled(isImage);
    for (const b of [this.copyButton, this.saveButton, optionsButton]) b.disabled = rep === undefined && b !== optionsButton;
    this.savePanel.setAttribute('aria-label', t('save.menu'));

    this.tab.textContent = def ? local(def.name) : input.selected;

    this.renderContent(input, rep);
    this.renderFigures(input, rep);

    // The options panel keeps its widgets while the person types in them; it is rebuilt when the representation or language changes.
    const optionsKey = `${input.selected}|${t('view.options')}|${rep?.kind ?? ''}`;
    if (this.optionsPopover.isOpen && optionsKey !== this.optionsKey) this.buildOptions(true);
    if (this.savePopover.isOpen) this.buildSaveMenu();
  }

  private renderContent(input: ViewInput, rep: RepresentationData | undefined): void {
    const label = t(this.key === 'a' ? 'view.a' : 'view.b');
    this.status.textContent = '';
    this.status.hidden = true;
    if (!rep || !input.model) {
      this.textScroll.hidden = true;
      this.diagram.element.hidden = true;
      this.status.hidden = false;
      this.status.textContent = input.loading ? t('status.loading') : t('view.empty');
      this.content.setAttribute('aria-busy', String(input.loading));
      return;
    }
    this.content.setAttribute('aria-busy', String(input.loading));
    if (rep.kind === 'image') {
      this.textScroll.hidden = true;
      this.diagram.element.hidden = false;
      this.diagram.setSvg(rep.text);
      this.altEl.textContent = input.model.alt;
      this.diagram.element.setAttribute('aria-label', t('view.diagramLabel', { view: label }));
      this.diagram.element.setAttribute('aria-describedby', this.altEl.id);
      this.shownText = null;
      this.shownId = null;
    } else {
      this.diagram.element.hidden = true;
      this.textScroll.hidden = false;
      this.altEl.textContent = '';
      this.textScroll.setAttribute('aria-label', t('view.textLabel', { view: label }));
      this.textScroll.dataset['wrap'] = String(input.wrap);
      if (this.shownText !== rep.text || this.shownId !== rep.id) {
        const keepScroll = this.shownId === rep.id;
        const top = this.textScroll.scrollTop;
        const left = this.textScroll.scrollLeft;
        const { code } = buildCode(rep.text, languageOfMime(rep.mime));
        this.textScroll.replaceChildren(code);
        if (keepScroll) this.textScroll.scrollTo(left, top);
        else this.textScroll.scrollTo(0, 0);
        this.shownText = rep.text;
        this.shownId = rep.id;
      }
    }
  }

  private renderFigures(input: ViewInput, rep: RepresentationData | undefined): void {
    const model = input.model;
    const row = model?.figures.rows.find((r) => r.id === input.selected);
    this.note.hidden = this.note.hidden || row?.kind !== 'text';
    if (!model || !row || !rep) {
      this.figuresText.textContent = '';
      this.infoButton.hidden = true;
      this.note.hidden = true;
      return;
    }
    if (row.kind === 'text') {
      this.figuresText.textContent = [
        t('figures.characters', { n: row.characters }),
        t('figures.lines', { n: row.lines }),
        `${t('figures.tokens', { n: row.tokens })} ${t('figures.tokenizer', { id: row.tokenizer })}`,
      ].join(' · ');
      this.infoButton.hidden = false;
      const text = t('figures.note', { name: model.figures.tokenizer.name, implementation: model.figures.tokenizer.implementation });
      this.note.textContent = text;
      this.infoButton.setAttribute('aria-label', t('figures.info'));
      this.infoButton.title = t('figures.info');
      this.figures.title = text;
    } else {
      this.figuresText.textContent = t('figures.diagram', { width: formatNumber(row.width), height: formatNumber(row.height), size: formatNumber(row.bytes / 1000, 1) });
      this.infoButton.hidden = true;
      this.note.hidden = true;
      this.figures.removeAttribute('title');
    }
  }

  // ---- options ---------------------------------------------------------------------------------------------------------------------

  private buildOptions(focus: boolean): void {
    const input = this.input;
    if (!input) return;
    const def = this.def(input.selected);
    const rep = this.currentRep();
    this.optionsKey = `${input.selected}|${t('view.options')}|${rep?.kind ?? ''}`;
    const children: Node[] = [el('h2', { class: 'popover-title' }, t('view.optionsOf', { name: def ? local(def.name) : input.selected }))];
    if (rep?.kind !== 'image') {
      const id = `${this.section.id}-wrap`;
      const wrap = el('input', { type: 'checkbox', role: 'switch', id, ...(input.wrap && { checked: true }) });
      wrap.checked = input.wrap;
      wrap.addEventListener('change', () => this.callbacks.onWrap(wrap.checked));
      children.push(el('div', { class: 'option' }, el('label', { class: 'option-row switch', for: id }, el('span', { class: 'option-label' }, t('view.wrap')), wrap, el('span', { class: 'switch-track', 'aria-hidden': 'true' }))));
    }
    if (def && def.options.length > 0) {
      children.push(
        optionFields({
          specs: def.options,
          values: effectiveValues(def.options, input.options[def.id]),
          idPrefix: `${this.section.id}-opt`,
          onChange: (key, value) => {
            const spec = def.options.find((s) => s.key === key);
            if (spec) this.callbacks.onOption(def.id, spec, value);
          },
        }),
      );
    } else {
      children.push(el('p', { class: 'option-desc' }, t('view.noOptions')));
    }
    this.optionsPanel.replaceChildren(...children);
    if (focus) {
      // Focus moves into the panel so that the keyboard can reach the first control; Escape returns it to the button.
      queueMicrotask(() => this.optionsPanel.querySelector<HTMLElement>('input, select')?.focus());
    }
  }

  // ---- copy and save -------------------------------------------------------------------------------------------------------------------

  private async copyCurrent(): Promise<void> {
    const rep = this.currentRep();
    if (!rep) return;
    const ok = await copyText(rep.text);
    this.callbacks.announce(ok ? t('view.copied') : t('view.copyFailed'));
    clearTimeout(this.copyTimer);
    const svg = this.copyButton.querySelector('svg');
    if (ok && svg) {
      svg.replaceWith(icon('check'));
      this.copyTimer = setTimeout(() => this.copyButton.firstElementChild?.replaceWith(icon('copy')), 1500);
    }
  }

  private fileName(rep: RepresentationData, extension = rep.extension): string {
    const base = this.input?.model?.baseName ?? 'model';
    return `${base}.${rep.id}.${extension}`;
  }

  private saveCurrentText(): void {
    const rep = this.currentRep();
    if (!rep) return;
    const name = this.fileName(rep);
    saveText(name, rep.mime, rep.text);
    this.callbacks.announce(t('view.saved', { name }));
  }

  private buildSaveMenu(): void {
    const rep = this.currentRep();
    if (!rep || rep.kind !== 'image' || rep.width === undefined || rep.height === undefined) {
      this.savePanel.replaceChildren();
      return;
    }
    const { width, height } = rep;
    const item = (label: string, disabled: string | null, action: () => void): HTMLButtonElement => {
      const b = el('button', { type: 'button', class: 'menu-item', ...(disabled !== null && { disabled: true, title: disabled }) }, label);
      if (disabled !== null) b.append(el('span', { class: 'option-desc' }, ` (${disabled})`));
      b.addEventListener('click', () => {
        this.savePopover.close(true);
        action();
      });
      return b;
    };
    const items: HTMLElement[] = [
      item(t('save.svg'), null, () => {
        const name = this.fileName(rep);
        saveText(name, rep.mime, rep.text);
        this.callbacks.announce(t('view.saved', { name }));
      }),
    ];
    for (const scale of PNG_SCALES) {
      items.push(
        item(t('save.png', { n: scale }), pngSizeAllowed(width, height, scale) ? null : t('save.pngTooLarge'), () => {
          void svgToPng(rep.text, width, height, scale).then(
            (blob) => {
              const name = this.fileName(rep, scale === 1 ? 'png' : `${scale}x.png`);
              saveBlob(name, blob);
              this.callbacks.announce(t('view.saved', { name }));
            },
            () => this.callbacks.announce(t('save.pngFailed')),
          );
        }),
      );
    }
    this.savePanel.replaceChildren(el('h2', { class: 'popover-title' }, t('save.menu')), ...items);
  }
}

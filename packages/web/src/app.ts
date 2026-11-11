import { createDefaultRegistry, typeName, type GeneratorDefinition, type Notice, type OptionSpec, type OptionValue } from '@repr-werkbank/core';
import { decodeInput, isDecodeError } from './decode.ts';
import { el } from './dom.ts';
import { copyText, saveText } from './download.ts';
import { FIRST_EXAMPLE, listExamples, loadExample } from './examples.ts';
import { getLang, local, setLang, t, type Lang } from './i18n.ts';
import { icon } from './icons.ts';
import { ExportPanel, type ExportStep, type PromptPreview } from './lower/export.ts';
import { renderInventory, type MissingSelection } from './lower/inventory.ts';
import { nextSort, renderOverview, type OverviewSort, type SortKey } from './lower/overview.ts';
import { textFigures } from './figures-text.ts';
import { renderStructure, type StructureState } from './lower/structure.ts';
import { effectiveValues, optionFields, validOptions, withOption } from './options-ui.ts';
import { attachPopover, closeOpenPopover, hasOpenPopover } from './popover.ts';
import type { AdditionData, CompleteResult, ElementInfo, ErrorResult, PartialResult, PromptResult } from './protocol.ts';
import { browserStorage, DEFAULT_VIEWS, loadState, saveState, type UiState } from './state.ts';
import { RepresentationView, type ViewModel } from './views/view.ts';
import { WorkerClient } from './worker-client.ts';

declare global {
  interface Window {
    /**
     * Read by scripts/screenshots.ts and the browser checks: the bundle file made by the worker for the current model, with the time the
     * phases took. Null while a bundle is being made.
     */
    __reprWerkbank?: { bundleJson: string | null; firstMs: number | null; completeMs: number | null; startMs: number | null; additionsMs: number | null };
  }
}

type LowerTab = 'overview' | 'inventory' | 'structure' | 'export';
const LOWER_TABS: { id: LowerTab; key: 'lower.overview' | 'lower.inventory' | 'lower.structure' | 'lower.export' }[] = [
  { id: 'overview', key: 'lower.overview' },
  { id: 'inventory', key: 'lower.inventory' },
  { id: 'structure', key: 'lower.structure' },
  { id: 'export', key: 'lower.export' },
];

/** Arrow keys move the focus between the buttons of a tab list; Home and End go to the first and the last. */
function arrowKeys(list: HTMLElement): void {
  list.addEventListener('keydown', (e) => {
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    tabs[(next + tabs.length) % tabs.length]?.focus();
  });
}

interface Source {
  text: string;
  inputName: string | null;
  /** Null for pasted text. */
  displayName: string | null;
}

interface LoadedModel {
  partial: PartialResult;
  source: Source;
  complete: CompleteResult | null;
}

interface ErrorInfo {
  title: string;
  detail: string;
  keeps: boolean;
}

export function mountApp(root: HTMLElement): void {
  const registry = createDefaultRegistry();
  const storage = browserStorage();
  const state: UiState = loadState(storage);
  setLang(state.lang);
  if (state.scheme) document.documentElement.dataset['scheme'] = state.scheme;
  document.documentElement.lang = state.lang;
  const persist = (): void => saveState(storage, state);

  const specsOf = (id: string): readonly OptionSpec[] | undefined => registry.list().find((d) => d.id === id)?.options;
  const defOf = (id: string): GeneratorDefinition | undefined => registry.list().find((d) => d.id === id);

  let model: LoadedModel | null = null;
  let source: Source | null = null;
  let loading = true;
  let error: ErrorInfo | null = null;
  let noticesOpen = false;
  let structure: StructureState = 'none';
  let openTab: LowerTab | null = null;
  /** The selected model element (node id or edge key), shown in both views (FA-61). */
  let selection: string | null = null;
  let elementMap = new Map<string, ElementInfo>();
  let overviewSort: OverviewSort | null = null;
  /** The inventory cell whose missing facts are listed (FA-54). */
  let missingOpen: MissingSelection | null = null;
  /** Counts the models shown, so that a prompt block made for an earlier model is never taken for the current one. */
  let modelVersion = 0;
  let promptResult: PromptResult | null = null;
  let promptError: string | null = null;
  let promptKey = '';
  let promptAsked = '';
  let requestStart = 0;
  let previousHook: NonNullable<Window['__reprWerkbank']> = { bundleJson: null, firstMs: null, completeMs: null, startMs: null, additionsMs: null };

  // ---- worker ---------------------------------------------------------------------------------------------------------------------
  const client = new WorkerClient({
    onPartial(result) {
      if (!source) return;
      model = { partial: result, source, complete: null };
      elementMap = new Map(result.elements.map((e) => [e.key, e]));
      modelVersion += 1;
      loading = false;
      error = null;
      structure = result.pending.length > 0 ? 'running' : 'done';
      window.__reprWerkbank = { bundleJson: null, firstMs: performance.now() - requestStart, completeMs: null, startMs: result.startMs, additionsMs: null };
      renderAll();
      requestPrompt();
    },
    onComplete(result) {
      if (!model) return;
      model = { ...model, complete: result };
      structure = 'done';
      window.__reprWerkbank = {
        bundleJson: result.bundleJson,
        firstMs: window.__reprWerkbank?.firstMs ?? null,
        completeMs: performance.now() - requestStart,
        startMs: window.__reprWerkbank?.startMs ?? null,
        additionsMs: result.additionsMs,
      };
      renderLower();
      requestPrompt();
    },
    onPrompt(result) {
      if (result.type === 'prompt-error') {
        promptError = result.message;
        promptResult = null;
      } else {
        promptError = null;
        promptResult = result;
        promptKey = promptAsked;
      }
      renderLower();
    },
    onError(result) {
      loading = false;
      // The previous model (if any) is still shown; its bundle is still the one on offer.
      window.__reprWerkbank = previousHook;
      error = describeError(result);
      if (structure === 'running') structure = 'cancelled';
      renderAll();
    },
  });

  function describeError(result: ErrorResult): ErrorInfo {
    const name = source?.displayName ?? t('header.pasted');
    const keeps = model !== null;
    if (result.kind === 'parse') return { title: t('error.title', { name }), detail: t('error.where', { line: result.line ?? 0, column: result.column ?? 0, message: result.message }), keeps };
    if (result.kind === 'options') return { title: t('error.title', { name }), detail: t('error.options', { message: result.message }), keeps };
    return { title: t('error.title', { name }), detail: t('error.internal', { message: result.message }), keeps };
  }

  function run(): void {
    if (!source) return;
    previousHook = model?.complete
      ? { bundleJson: model.complete.bundleJson, firstMs: null, completeMs: null, startMs: null, additionsMs: model.complete.additionsMs }
      : { bundleJson: null, firstMs: null, completeMs: null, startMs: null, additionsMs: null };
    loading = true;
    requestStart = performance.now();
    window.__reprWerkbank = { bundleJson: null, firstMs: null, completeMs: null, startMs: null, additionsMs: null };
    client.run({ text: source.text, inputName: source.inputName, options: validOptions(specsOf, state.options) });
    renderStatus();
    renderViews();
  }

  function load(text: string, inputName: string | null, displayName: string | null): void {
    closeOpenPopover();
    source = { text, inputName, displayName };
    selection = null;
    missingOpen = null;
    error = null;
    noticesOpen = false;
    run();
  }

  async function loadFile(file: File): Promise<void> {
    try {
      const text = decodeInput(new Uint8Array(await file.arrayBuffer()));
      load(text, file.name, file.name);
    } catch (e) {
      loading = false;
      error = { title: t('error.title', { name: file.name }), detail: isDecodeError(e) ? t('error.notUtf8') : t('error.internal', { message: e instanceof Error ? e.message : String(e) }), keeps: model !== null };
      renderAll();
    }
  }

  // ---- state changes --------------------------------------------------------------------------------------------------------------
  function setOption(generatorId: string, spec: OptionSpec, value: OptionValue): void {
    state.options = withOption(state.options, generatorId, spec, value);
    persist();
    run();
  }

  const effectiveView = (index: 0 | 1): string => {
    const ids = model?.partial.representations.map((r) => r.id) ?? [];
    const stored = state.views[index];
    if (ids.length === 0 || ids.includes(stored)) return stored;
    const fallback = DEFAULT_VIEWS[index];
    return ids.includes(fallback) ? fallback : (ids[0] ?? stored);
  };

  // ---- live region ----------------------------------------------------------------------------------------------------------------
  const live = el('div', { class: 'sr-only', 'aria-live': 'polite', role: 'status' });
  const announce = (message: string): void => {
    live.textContent = '';
    // A changed text is announced; the empty step makes a repeated message count as a change.
    setTimeout(() => (live.textContent = message), 30);
  };

  // ---- header ---------------------------------------------------------------------------------------------------------------------
  const textButton = (cls = 'text-button'): HTMLButtonElement => el('button', { type: 'button', class: cls });
  const loadButton = textButton();
  const examplesButton = textButton();
  const aboutButton = textButton();
  const formatsButton = textButton();
  for (const b of [aboutButton, formatsButton]) b.setAttribute('aria-disabled', 'true');
  const langButton = textButton('text-button segmented');
  const langEn = el('span', {}, 'EN');
  const langDe = el('span', {}, 'DE');
  langButton.append(langEn, el('span', { class: 'sep', 'aria-hidden': 'true' }, '|'), langDe);
  langButton.addEventListener('click', () => {
    const next: Lang = getLang() === 'en' ? 'de' : 'en';
    setLang(next);
    state.lang = next;
    document.documentElement.lang = next;
    persist();
    closeOpenPopover();
    renderAll();
  });
  const schemeButton = el('button', { type: 'button', class: 'icon-button' });
  schemeButton.append(icon('scheme'));
  const systemIsDark = (): boolean => window.matchMedia('(prefers-color-scheme: dark)').matches;
  const effectiveScheme = (): 'light' | 'dark' => state.scheme ?? (systemIsDark() ? 'dark' : 'light');
  schemeButton.addEventListener('click', () => {
    state.scheme = effectiveScheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset['scheme'] = state.scheme;
    persist();
    renderHeader();
  });

  const modelName = el('span', { class: 'model-name' });
  const modelLine = el('p', { class: 'model' });
  const nav = el('nav', { class: 'actions' }, loadButton, examplesButton, langButton, schemeButton, aboutButton, formatsButton);

  // Load panel
  const fileInput = el('input', { type: 'file', id: 'file-input', class: 'sr-only', accept: '.bpmn,.pnml,.xml,application/xml,text/xml', tabindex: '-1' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void loadFile(file);
  });
  const chooseButton = el('button', { type: 'button', class: 'push-button is-primary' });
  chooseButton.addEventListener('click', () => fileInput.click());
  const fileHint = el('p', { class: 'muted' });
  const pasteLabel = el('label', { for: 'paste-text', class: 'option-label' });
  const pasteArea = el('textarea', { id: 'paste-text', class: 'paste', rows: '5', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off' });
  const readButton = el('button', { type: 'button', class: 'push-button' });
  readButton.addEventListener('click', () => {
    if (pasteArea.value.trim() === '') return;
    load(pasteArea.value, null, null);
    pasteArea.value = '';
  });
  const dropHint = el('p', { class: 'muted' });
  const loadTitle = el('h2', { class: 'popover-title' });
  const loadPanel = el('div', { class: 'popover popover-top', id: 'load-panel', role: 'group' }, loadTitle, chooseButton, fileInput, fileHint, pasteLabel, pasteArea, readButton, dropHint);
  attachPopover(loadButton, loadPanel, () => queueMicrotask(() => chooseButton.focus()));

  // Examples panel
  const examples = listExamples();
  const examplesTitle = el('h2', { class: 'popover-title' });
  const examplesList = el('ul', { class: 'example-list' });
  const examplesPanel = el('div', { class: 'popover popover-top', id: 'examples-panel', role: 'group' }, examplesTitle, examplesList);
  const examplesPopover = attachPopover(examplesButton, examplesPanel);
  for (const ex of examples) {
    const b = el('button', { type: 'button', class: 'example' }, el('span', { class: 'example-head' }, el('span', { class: 'example-name' }, ex.name), el('span', { class: 'example-mark' }, '')), el('span', { class: 'example-desc' }, ex.description));
    b.addEventListener('click', () => {
      examplesPopover.close(true);
      void openExample(ex.path, ex.name);
    });
    examplesList.append(el('li', {}, b));
  }
  async function openExample(path: string, name: string): Promise<void> {
    try {
      load(await loadExample(path), name, name);
    } catch (e) {
      loading = false;
      error = { title: t('error.title', { name }), detail: t('error.internal', { message: e instanceof Error ? e.message : String(e) }), keeps: model !== null };
      renderAll();
    }
  }

  const header = el('header', { class: 'top' }, el('span', { class: 'brand' }, 'repr-werkbank'), modelLine, nav, loadPanel, examplesPanel);

  function renderHeader(): void {
    // While an error is shown the previous model is still on screen, so its name stays.
    const shown = model?.source ?? source;
    modelName.textContent = shown ? (shown.displayName ?? t('header.pasted')) : t('header.noModel');
    modelLine.replaceChildren(`${t('header.model')}: `, modelName);
    nav.setAttribute('aria-label', t('header.nav'));
    loadButton.textContent = t('header.load');
    examplesButton.textContent = t('header.examples');
    aboutButton.textContent = t('header.about');
    formatsButton.textContent = t('header.formats');
    for (const b of [aboutButton, formatsButton]) b.title = t('common.notYet');
    const lang = getLang();
    langEn.className = lang === 'en' ? 'is-active' : '';
    langDe.className = lang === 'de' ? 'is-active' : '';
    langButton.setAttribute('aria-label', t('header.languageSwitch', { current: lang === 'en' ? 'English' : 'Deutsch', other: lang === 'en' ? 'Deutsch' : 'English' }));
    langButton.title = t('header.language');
    const toDark = effectiveScheme() === 'light';
    const schemeLabel = t(toDark ? 'header.schemeToDark' : 'header.schemeToLight');
    schemeButton.setAttribute('aria-label', schemeLabel);
    schemeButton.title = schemeLabel;
    loadTitle.textContent = t('load.title');
    chooseButton.textContent = t('load.file');
    fileHint.textContent = t('load.fileHint');
    pasteLabel.textContent = t('load.paste');
    readButton.textContent = t('load.read');
    dropHint.textContent = t('load.drop');
    examplesTitle.textContent = t('examples.title');
    examplesList.querySelectorAll('.example-mark').forEach((m) => (m.textContent = t('examples.mark')));
  }

  // ---- messages under the header --------------------------------------------------------------------------------------------------
  const messages = el('div', { class: 'messages' });

  function renderStatus(): void {
    messages.setAttribute('role', 'region');
    messages.setAttribute('aria-label', t('status.region'));
    const children: Node[] = [];
    if (error) {
      const dismiss = el('button', { type: 'button', class: 'icon-button', 'aria-label': t('error.dismiss'), title: t('error.dismiss') });
      dismiss.append(icon('close'));
      dismiss.addEventListener('click', () => {
        error = null;
        renderStatus();
      });
      children.push(
        el(
          'div',
          { class: 'message', role: 'alert' },
          icon('warning'),
          el('div', { class: 'message-text' }, el('strong', {}, error.title), el('span', {}, ` ${error.detail}`), ...(error.keeps ? [el('span', { class: 'muted' }, ` ${t('error.keep')}`)] : [])),
          dismiss,
        ),
      );
    }
    const notices: Notice[] = model?.partial.notices ?? [];
    const noticeCount = notices.reduce((n, x) => n + x.count, 0);
    if (noticeCount > 0) {
      const toggle = el('button', { type: 'button', class: 'text-button', 'aria-expanded': String(noticesOpen), 'aria-controls': 'notice-list' }, noticesOpen ? t('notices.hide') : t('notices.show'));
      toggle.addEventListener('click', () => {
        noticesOpen = !noticesOpen;
        renderStatus();
      });
      const list = el('ul', { class: 'notice-list', id: 'notice-list', hidden: !noticesOpen });
      for (const n of notices) {
        const head = `${t(`notices.kind.${n.kind}` as 'notices.kind.extension')}: ${n.type} (${n.count})`;
        const item = el('li', {}, el('span', { class: 'notice-type' }, head));
        const ids = el('ul', { class: 'notice-items' });
        for (const it of n.items) ids.append(el('li', {}, [it.id !== undefined ? `${it.id}` : null, t('notices.line', { line: it.line }), it.detail !== undefined ? `“${it.detail}”` : null].filter((x) => x !== null).join(' · ')));
        item.append(ids);
        list.append(item);
      }
      children.push(el('div', { class: 'message', role: 'status' }, icon('info'), el('div', { class: 'message-text' }, t('notices.title', { n: noticeCount })), toggle), list);
    }
    messages.replaceChildren(...children);
  }

  // ---- views ----------------------------------------------------------------------------------------------------------------------
  const makeView = (key: 'a' | 'b', index: 0 | 1): RepresentationView =>
    new RepresentationView(key, registry, {
      onSelect(id) {
        state.views = index === 0 ? [id, state.views[1]] : [state.views[0], id];
        persist();
        renderViews();
      },
      onOption: setOption,
      onWrap(wrap) {
        state.wrap = index === 0 ? [wrap, state.wrap[1]] : [state.wrap[0], wrap];
        persist();
        renderViews();
      },
      onPick: (key) => setSelection(key, index === 0 ? 'a' : 'b'),
      announce,
    });
  const viewA = makeView('a', 0);
  const viewB = makeView('b', 1);
  const narrowTabs = el('div', { class: 'narrow-tabs', role: 'tablist' }, viewA.tab, viewB.tab);
  arrowKeys(narrowTabs);
  const selectNarrow = (key: 'a' | 'b'): void => {
    for (const [k, v] of [['a', viewA], ['b', viewB]] as const) {
      const active = k === key;
      v.tab.setAttribute('aria-selected', String(active));
      v.tab.tabIndex = active ? 0 : -1;
      v.section.dataset['narrowActive'] = String(active);
    }
  };
  viewA.tab.addEventListener('click', () => selectNarrow('a'));
  viewB.tab.addEventListener('click', () => selectNarrow('b'));
  selectNarrow('a');
  const views = el('main', { class: 'views' }, narrowTabs, viewA.section, viewB.section);

  /** "Aufgabe: Bestellung prüfen": the type in the interface language and the label, else the key. For buttons and announcements. */
  function describeElement(key: string): string {
    const info = elementMap.get(key);
    if (!info) return key;
    const nameOf = (id: string): string => elementMap.get(id)?.label ?? id;
    const label = info.label ?? (info.source !== undefined && info.target !== undefined ? `${nameOf(info.source)} → ${nameOf(info.target)}` : key);
    return `${typeName(info.type, getLang())}: ${label}`;
  }

  /** Selects an element in both views (FA-61), or clears the selection. The view the person acted in is not scrolled. */
  function setSelection(key: string | null, origin: 'a' | 'b' | null): void {
    const had = selection !== null;
    selection = key;
    const shownA = viewA.showSelection(key, origin !== 'a');
    const shownB = viewB.showSelection(key, origin !== 'b');
    if (key === null) {
      if (had) announce(t('select.cleared'));
      return;
    }
    const hidden = [shownA ? null : t('view.a'), shownB ? null : t('view.b')].filter((x) => x !== null);
    const parts = [t('select.selected', { what: describeElement(key) })];
    if (hidden.length > 0) parts.push(t('select.notShown', { views: hidden.join(', ') }));
    announce(parts.join(' '));
  }

  document.addEventListener(
    'keydown',
    (e) => {
      // Escape closes an open panel first; with none open it clears the selection.
      if (e.key === 'Escape' && selection !== null && !hasOpenPopover()) setSelection(null, null);
    },
    true,
  );

  function viewModel(): ViewModel | null {
    if (!model) return null;
    const p = model.partial;
    const name = model.source.displayName;
    return {
      representations: p.representations,
      figures: p.figures,
      alt: getLang() === 'de' ? p.alt.de : p.alt.en,
      baseName: name === null ? 'model' : name.replace(/\.[^./\\]+$/, ''),
      describe: describeElement,
    };
  }

  function renderViews(): void {
    const vm = viewModel();
    narrowTabs.setAttribute('aria-label', t('view.tabs'));
    viewA.render({ selected: effectiveView(0), model: vm, loading, wrap: state.wrap[0], options: state.options });
    viewB.render({ selected: effectiveView(1), model: vm, loading, wrap: state.wrap[1], options: state.options });
  }

  // ---- lower area -----------------------------------------------------------------------------------------------------------------
  const panel = el('div', { class: 'lower-panel', role: 'tabpanel', id: 'lower-panel', hidden: true });
  const lowerTabs = el('div', { class: 'lower-tabs', role: 'tablist' });
  const lower = el('section', { class: 'lower', 'data-open': 'false' }, lowerTabs, panel);
  const tabButtons = new Map<LowerTab, HTMLButtonElement>();
  for (const tab of LOWER_TABS) {
    const b = el('button', { type: 'button', role: 'tab', class: 'tab', id: `lower-tab-${tab.id}`, 'aria-selected': 'false', 'aria-expanded': 'false', 'aria-controls': 'lower-panel' });
    b.addEventListener('click', () => {
      setOpen(openTab === tab.id ? null : tab.id);
    });
    tabButtons.set(tab.id, b);
    lowerTabs.append(b);
  }
  arrowKeys(lowerTabs);

  function setOpen(next: LowerTab | null): void {
    openTab = next;
    for (const [id, b] of tabButtons) {
      b.setAttribute('aria-selected', String(id === openTab));
      b.setAttribute('aria-expanded', String(id === openTab));
    }
    if (openTab) panel.setAttribute('aria-labelledby', `lower-tab-${openTab}`);
    panel.hidden = openTab === null;
    lower.dataset['open'] = String(openTab !== null);
    renderLower();
  }

  const additions = (): AdditionData[] => model?.complete?.additions ?? [];

  /** Options of the additions (the structure report): one list, a change of a shared key is applied to every addition that has it. */
  function structureOptions(): HTMLElement | null {
    const adds = registry.listFor(model?.partial.metadata.formalism ?? 'bpmn').filter((d) => d.role === 'addition');
    const first = adds[0];
    if (!first) return null;
    const specs = new Map<string, OptionSpec>();
    for (const d of adds) for (const s of d.options) if (!specs.has(s.key)) specs.set(s.key, s);
    const all = [...specs.values()];
    // The first addition (the text report) holds the values; the others share the keys they have in common.
    const values = effectiveValues(first.options, state.options[first.id]);
    for (const s of all) if (!(s.key in values)) values[s.key] = effectiveValues([s], state.options[adds.find((d) => d.options.some((o) => o.key === s.key))?.id ?? ''])[s.key] ?? s.default;
    return optionFields({
      specs: all,
      values,
      idPrefix: 'structure-opt',
      onChange(key, value) {
        const spec = specs.get(key);
        if (!spec) return;
        let next = state.options;
        for (const d of adds) if (d.options.some((o) => o.key === key)) next = withOption(next, d.id, spec, value);
        state.options = next;
        persist();
        run();
      },
    });
  }

  function saveAddition(id: string): void {
    const add = additions().find((a) => a.id === id);
    if (!add || !model) return;
    const base = model.source.displayName?.replace(/\.[^./\\]+$/, '') ?? 'model';
    saveText(`${base}.${add.id}.${add.extension}`, add.mime, add.text);
    announce(t('view.saved', { name: `${base}.${add.id}.${add.extension}` }));
  }

  // ---- export: prompt block (FA-28, FA-71) ----------------------------------------------------------------------------------------

  /** Text generators that exist for the loaded model, in registry order. */
  const textGenerators = (): GeneratorDefinition[] => registry.listFor(model?.partial.metadata.formalism ?? 'bpmn').filter((d) => d.kind === 'text');

  /** The composition: the stored one with generators dropped that the model does not support. The first time, the two views' texts. */
  function exportSteps(): string[] {
    const valid = new Set(textGenerators().map((d) => d.id));
    const stored = state.exportSteps ?? [...new Set([effectiveView(0), effectiveView(1)])];
    return stored.filter((id, i) => valid.has(id) && stored.indexOf(id) === i);
  }

  function setSteps(steps: string[]): void {
    state.exportSteps = steps;
    persist();
    requestPrompt();
    renderLower();
  }

  const exportPanel = new ExportPanel({
    add: (id) => setSteps([...exportSteps(), id]),
    remove: (i) => setSteps(exportSteps().filter((_, k) => k !== i)),
    move(i, delta) {
      const steps = exportSteps();
      const j = i + delta;
      if (j < 0 || j >= steps.length) return;
      [steps[i], steps[j]] = [steps[j] as string, steps[i] as string];
      setSteps(steps);
    },
    setHeader(on) {
      state.exportHeader = on;
      persist();
      requestPrompt();
      renderLower();
    },
    copy: () => void copyText(promptResult?.text ?? '').then((ok) => announce(ok ? t('view.copied') : t('view.copyFailed'))),
    save() {
      if (!promptResult || !model) return;
      const name = `${baseName()}.prompt.txt`;
      saveText(name, 'text/plain', promptResult.text);
      announce(t('view.saved', { name }));
    },
    saveBundle() {
      const complete = model?.complete;
      if (!complete || !model) return;
      const name = `${baseName()}.bundle.json`;
      saveText(name, 'application/json', complete.bundleJson);
      announce(t('view.saved', { name }));
    },
  });

  function baseName(): string {
    return model?.source.displayName?.replace(/\.[^./\\]+$/, '') ?? 'model';
  }

  /** Why the prompt block cannot be made now, or null. A step that is a structure report needs the finished computation. */
  function promptBlocked(steps: readonly string[]): string | null {
    if (!steps.some((id) => defOf(id)?.role === 'addition')) return null;
    if (structure === 'cancelled') return t('export.promptCancelled');
    return structure === 'done' ? null : t('export.promptComputing');
  }

  /** Asks the worker for the prompt block of the current composition when the export tab is open and nothing newer has been asked. */
  function requestPrompt(): void {
    if (openTab !== 'export' || !model) return;
    const steps = exportSteps();
    if (steps.length === 0 || promptBlocked(steps) !== null) return;
    const options = validOptions(specsOf, state.options);
    const key = `${modelVersion}|${state.exportHeader}|${steps.join(',')}|${JSON.stringify(options)}`;
    if (key === promptAsked && (promptResult !== null || promptError !== null)) return;
    promptAsked = key;
    promptError = null;
    client.prompt({ text: model.source.text, inputName: model.source.inputName, options, steps, header: state.exportHeader });
  }

  function promptPreview(steps: readonly string[]): PromptPreview {
    if (steps.length === 0) return { status: 'empty' };
    const blocked = promptBlocked(steps);
    if (blocked !== null) return { status: 'blocked', reason: blocked };
    if (promptError !== null) return { status: 'error', reason: t('export.promptError', { message: promptError }) };
    if (!promptResult || promptKey !== promptAsked) return promptResult ? { status: 'loading', text: promptResult.text } : { status: 'loading' };
    const r = promptResult;
    return { status: 'ready', text: r.text, figures: textFigures(r), note: t('figures.note', { name: r.tokenizerName, implementation: r.tokenizerImplementation }) };
  }

  /** After a panel is rebuilt the focus returns to the same control (found by what identifies it), so the keyboard is not thrown out. */
  function restoreFocus(): () => void {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !panel.contains(active)) return () => undefined;
    const keys = ['data-column', 'data-category', 'data-sort', 'data-element'].filter((k) => active.hasAttribute(k));
    if (keys.length === 0) return () => undefined;
    const selector = `${active.tagName.toLowerCase()}${keys.map((k) => `[${k}="${CSS.escape(active.getAttribute(k) ?? '')}"]`).join('')}`;
    return () => panel.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  function renderLower(): void {
    for (const tab of LOWER_TABS) {
      const b = tabButtons.get(tab.id);
      if (b) b.textContent = t(tab.key);
    }
    lowerTabs.setAttribute('aria-label', t('lower.label'));
    if (openTab === null) return;
    const columnName = (id: string): string => {
      const d = defOf(id);
      return d ? local(d.name) : id;
    };
    // The scroll position of the panel survives a re-render (a language change, the end of the structure computation).
    const top = panel.scrollTop;
    const refocus = restoreFocus();
    const mount = (node: Node): void => {
      if (panel.firstChild !== node || panel.childNodes.length !== 1) panel.replaceChildren(node);
    };
    if (openTab === 'overview') {
      mount(model ? renderOverview(model.partial.figures, columnName, overviewSort, (key: SortKey) => {
        overviewSort = nextSort(overviewSort, key);
        renderLower();
      }) : el('p', { class: 'muted pad' }, t('status.empty')));
    } else if (openTab === 'inventory') {
      mount(
        model
          ? renderInventory(model.partial.inventory, columnName, missingOpen, {
              onCell(sel) {
                const same = missingOpen?.column === sel.column && missingOpen.category === sel.category;
                missingOpen = same ? null : sel;
                renderLower();
                if (!same) {
                  panel.querySelector('#inventory-missing')?.scrollIntoView({ block: 'nearest' });
                  const n = model?.partial.inventory.columns.find((c) => c.id === sel.column)?.cells.find((c) => c.category === sel.category)?.missing.length ?? 0;
                  announce(t('inventory.missingAnnounce', { n }));
                }
              },
              onElement: (key) => setSelection(key, null),
            })
          : el('p', { class: 'muted pad' }, t('status.empty')),
      );
    } else if (openTab === 'structure') {
      const text = additions().find((a) => a.id === 'structure-report')?.text ?? null;
      mount(
        renderStructure({
          state: model ? structure : 'none',
          text,
          options: model ? structureOptions() : null,
          onCancel: () => {
            client.cancel();
            structure = 'cancelled';
            window.__reprWerkbank = { bundleJson: null, firstMs: window.__reprWerkbank?.firstMs ?? null, completeMs: null, startMs: window.__reprWerkbank?.startMs ?? null, additionsMs: null };
            renderLower();
          },
          onAgain: () => run(),
          onSave: () => saveAddition('structure-report-json'),
          onCopy: () => void copyText(text ?? '').then((ok) => announce(ok ? t('view.copied') : t('view.copyFailed'))),
        }),
      );
    } else {
      // The first time the tab is opened the composition is fixed to what the views show; from then on it is the person's.
      if (state.exportSteps === null && model) {
        state.exportSteps = exportSteps();
        persist();
      }
      const steps = exportSteps();
      const named = (id: string): ExportStep => ({ id, name: columnName(id) });
      exportPanel.update({
        steps: steps.map(named),
        available: textGenerators().filter((d) => !steps.includes(d.id)).map((d) => named(d.id)),
        header: state.exportHeader,
        preview: model ? promptPreview(steps) : { status: 'empty' },
        bundle: model?.complete ? 'ready' : structure === 'cancelled' ? 'cancelled' : 'computing',
      });
      mount(exportPanel.root);
      requestPrompt();
    }
    refocus();
    panel.scrollTop = top;
  }

  function renderAll(): void {
    renderHeader();
    renderStatus();
    renderViews();
    renderLower();
  }

  // ---- drag and drop anywhere on the page (FA-01) -----------------------------------------------------------------------------------
  const dropOverlay = el('div', { class: 'drop-overlay', hidden: true }, el('p', {}, ''));
  let dragDepth = 0;
  const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.hidden = false;
    (dropOverlay.firstElementChild as HTMLElement).textContent = t('load.dropOverlay');
  });
  window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
  });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });

  root.replaceChildren(el('div', { class: 'shell' }, header, messages, views, lower), live, dropOverlay);
  renderAll();
  void openExample(FIRST_EXAMPLE, FIRST_EXAMPLE.slice(FIRST_EXAMPLE.lastIndexOf('/') + 1));
}


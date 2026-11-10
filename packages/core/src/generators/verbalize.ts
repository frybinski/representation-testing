import type { ModelEdge, ModelNode, NodeType, ProcessModel } from '../model.js';
import { Carrier } from './carry.js';
import type { GeneratorDefinition, OptionValues, TextOutput, TextSpan } from './types.js';

/**
 * Rule-based verbalization (FA-25), German and English, no language model.
 * Sentence patterns and conventions: docs/verbalization.md.
 */

type Lang = 'de' | 'en';

interface TypeWord {
  en: { art: string; word: string };
  de: { art: string; word: string };
}

const w = (enArt: string, enWord: string, deArt: string, deWord: string): TypeWord => ({
  en: { art: enArt, word: enWord },
  de: { art: deArt, word: deWord },
});

const TYPE_WORDS: Partial<Record<NodeType, TypeWord>> = {
  task: w('a', 'task', 'eine', 'Aufgabe'),
  userTask: w('a', 'user task', 'eine', 'Benutzeraufgabe'),
  serviceTask: w('a', 'service task', 'eine', 'Serviceaufgabe'),
  scriptTask: w('a', 'script task', 'eine', 'Skriptaufgabe'),
  sendTask: w('a', 'send task', 'eine', 'Sendeaufgabe'),
  receiveTask: w('a', 'receive task', 'eine', 'Empfangsaufgabe'),
  manualTask: w('a', 'manual task', 'eine', 'manuelle Aufgabe'),
  businessRuleTask: w('a', 'business rule task', 'eine', 'Geschäftsregelaufgabe'),
  startEvent: w('a', 'start event', 'ein', 'Startereignis'),
  endEvent: w('an', 'end event', 'ein', 'Endereignis'),
  intermediateCatchEvent: w('an', 'intermediate catch event', 'ein', 'fangendes Zwischenereignis'),
  intermediateThrowEvent: w('an', 'intermediate throw event', 'ein', 'werfendes Zwischenereignis'),
  exclusiveGateway: w('an', 'exclusive gateway', 'ein', 'exklusives Gateway'),
  parallelGateway: w('a', 'parallel gateway', 'ein', 'paralleles Gateway'),
  inclusiveGateway: w('an', 'inclusive gateway', 'ein', 'inklusives Gateway'),
  eventBasedGateway: w('an', 'event-based gateway', 'ein', 'ereignisbasiertes Gateway'),
  subProcess: w('a', 'sub-process', 'einen', 'Teilprozess'),
  participant: w('a', 'participant', 'einen', 'Teilnehmer'),
  lane: w('a', 'lane', 'eine', 'Bahn'),
  dataObject: w('a', 'data object', 'ein', 'Datenobjekt'),
  dataObjectReference: w('a', 'data object reference', 'eine', 'Datenobjektreferenz'),
  textAnnotation: w('a', 'text annotation', 'eine', 'Textanmerkung'),
  place: w('a', 'place', 'eine', 'Stelle'),
  transition: w('a', 'transition', 'einen', 'Übergang'),
};
const SILENT_WORD: TypeWord = w('a', 'silent transition', 'einen', 'stillen Übergang');

const quote = (s: string): string => JSON.stringify(s);

const list = (lang: Lang, items: string[]): string => {
  if (items.length <= 1) return items.join('');
  const and = lang === 'en' ? ' and ' : ' und ';
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1] ?? ''}`;
};

const tokens = (lang: Lang, n: number): string => (lang === 'en' ? `${String(n)} token${n === 1 ? '' : 's'}` : `${String(n)} ${n === 1 ? 'Marke' : 'Marken'}`);

function verbalize(model: ProcessModel, options: OptionValues): TextOutput {
  const lang: Lang = options.language === 'de' ? 'de' : 'en';
  const showIds = options.showIdentifiers === true;
  const en = lang === 'en';
  const pnml = model.formalism === 'pnml';
  const c = new Carrier(model);
  const spans: TextSpan[] = [];
  let text = '';

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const described = (n: ModelNode): boolean =>
    pnml ? n.type === 'place' || n.type === 'transition' : TYPE_WORDS[n.type] !== undefined;
  const nodes = model.nodes.filter(described);
  const isDescribed = new Set(nodes.map((n) => n.id));

  const wordOf = (n: ModelNode): { art: string; word: string } => {
    const t = n.type === 'transition' && n.attributes.silent === true ? SILENT_WORD : TYPE_WORDS[n.type];
    if (!t) throw new Error(`No type word for ${n.type}`);
    return t[lang];
  };

  // Reference: the quoted label when it is unique among described nodes, otherwise a numbered alias introduced in the node's own sentence.
  const labelCount = new Map<string, number>();
  for (const n of nodes) if (n.name) labelCount.set(n.name, (labelCount.get(n.name) ?? 0) + 1);
  const refs = new Map<string, { text: string; alias: boolean }>();
  const aliasCounter = new Map<string, number>();
  for (const n of nodes) {
    if (n.name && labelCount.get(n.name) === 1) refs.set(n.id, { text: quote(n.name), alias: false });
    else {
      const word = wordOf(n).word;
      const k = (aliasCounter.get(word) ?? 0) + 1;
      aliasCounter.set(word, k);
      refs.set(n.id, { text: `${word} ${String(k)}`, alias: true });
    }
  }
  const ref = (id: string): string => refs.get(id)?.text ?? '';

  const outgoing = new Map<string, ModelEdge[]>();
  const incoming = new Map<string, ModelEdge[]>();
  for (const e of model.edges) {
    if (!isDescribed.has(e.source) || !isDescribed.has(e.target)) continue;
    outgoing.set(e.source, [...(outgoing.get(e.source) ?? []), e]);
    incoming.set(e.target, [...(incoming.get(e.target) ?? []), e]);
  }

  const sentence = (body: string, ids: (string | undefined)[]): void => {
    if (text !== '' && !text.endsWith('\n')) text += ' ';
    const factIds = [...new Set(ids.filter((x): x is string => x !== undefined))];
    const sentenceText = `${body}.`;
    if (factIds.length > 0) spans.push({ start: text.length, end: text.length + sentenceText.length, factIds });
    text += sentenceText;
  };

  const describeNode = (n: ModelNode): void => {
    const ids: (string | undefined)[] = [];
    const t = wordOf(n);
    const info = refs.get(n.id);
    let s1 = en ? `There is ${t.art} ${t.word}` : `Es gibt ${t.art} ${t.word}`;
    const label = n.type === 'textAnnotation' ? undefined : n.name;

    if (pnml) {
      ids.push(c.add(n.type === 'place' ? 'place' : 'transition', n.id, '', ''));
      if (n.type === 'transition' && n.attributes.silent === true) ids.push(c.add('silentTransition', n.id, '', ''));
    } else if (n.type === 'participant' || n.type === 'lane') {
      ids.push(c.add('poolLane', n.id, 'kind', n.type));
    } else if (n.type === 'dataObject' || n.type === 'dataObjectReference') {
      ids.push(c.add('dataObject', n.id, 'kind', n.type));
    } else if (n.type === 'textAnnotation') {
      ids.push(c.add('annotation', n.id, 'kind', 'textAnnotation'));
    } else {
      ids.push(c.add('node', n.id, '', ''));
      ids.push(c.add('nodeType', n.id, '', n.type));
    }

    if (n.type === 'textAnnotation') {
      const body = String(n.attributes.text ?? '');
      s1 += en ? ` with the text ${quote(body)}` : ` mit dem Text ${quote(body)}`;
      ids.push(c.add('annotation', n.id, 'text', body));
    } else if (label) {
      s1 += en ? ` named ${quote(label)}` : ` namens ${quote(label)}`;
      ids.push(c.add('label', n.id, '', label));
    } else {
      s1 += en ? ' without a name' : ' ohne Namen';
    }
    if (info?.alias) s1 += en ? `, referred to below as ${info.text}` : `, im Folgenden ${info.text} genannt`;
    if (showIds && n.idExplicit) {
      s1 += en ? `, with the identifier ${quote(n.id)}` : `, mit dem Bezeichner ${quote(n.id)}`;
      ids.push(c.add('identifier', n.id, '', n.id));
    }

    const parent = n.parent === undefined ? undefined : byId.get(n.parent);
    if (!pnml && parent && isDescribed.has(parent.id)) {
      s1 += en ? `, located inside ${ref(parent.id)}` : `, enthalten in ${ref(parent.id)}`;
      if (n.type === 'participant' || n.type === 'lane') ids.push(c.add('poolLane', n.id, 'parent', parent.id));
      else if (n.type === 'dataObject' || n.type === 'dataObjectReference') ids.push(c.add('dataObject', n.id, 'parent', parent.id));
      else if (n.type === 'textAnnotation') ids.push(c.add('annotation', n.id, 'parent', parent.id));
      else ids.push(c.add('node', n.id, 'parent', parent.id));
    }
    if (!pnml) {
      const defs = Array.isArray(n.attributes.eventDefinitions) ? n.attributes.eventDefinitions.map(String) : [];
      if (defs.length > 0) {
        s1 += en
          ? `, with the event ${defs.length === 1 ? 'definition' : 'definitions'} ${list(lang, defs)}`
          : `, mit ${defs.length === 1 ? 'der Ereignisdefinition' : 'den Ereignisdefinitionen'} ${list(lang, defs)}`;
        for (const d of defs) ids.push(c.add('eventType', n.id, '', d));
      }
      const processRef = n.attributes.processRef;
      if (typeof processRef === 'string') {
        s1 += en ? `, executing the process ${quote(processRef)}` : `, der den Prozess ${quote(processRef)} ausführt`;
        ids.push(c.add('poolLane', n.id, 'process', processRef));
      }
      const target = n.attributes.dataObjectRef;
      if (typeof target === 'string' && isDescribed.has(target)) {
        s1 += en ? `, referring to ${ref(target)}` : `, die auf ${ref(target)} verweist`;
        ids.push(c.add('dataObject', n.id, 'ref', target));
      }
    }
    if (pnml && n.type === 'place') {
      const initial = n.attributes.initialMarking;
      if (typeof initial === 'number' && initial > 0) {
        s1 += en ? `, initially holding ${tokens(lang, initial)}` : `, anfangs mit ${tokens(lang, initial)}`;
        ids.push(c.add('initialMarking', n.id, '', String(initial)));
      }
      const finals = Array.isArray(n.attributes.finalMarkings) ? n.attributes.finalMarkings : [];
      finals.forEach((count, i) => {
        if (typeof count !== 'number' || count <= 0) return;
        const k = String(i + 1);
        if (finals.length > 1) s1 += en ? `, holding ${tokens(lang, count)} in final marking ${k}` : `, mit ${tokens(lang, count)} in Endmarkierung ${k}`;
        else s1 += en ? `, holding ${tokens(lang, count)} in the final marking` : `, mit ${tokens(lang, count)} in der Endmarkierung`;
        ids.push(c.add('finalMarking', n.id, finals.length > 1 ? `m${k}` : '', String(count)));
      });
    }
    sentence(s1, ids);

    // Second sentence: neighbours and relations.
    const ids2: (string | undefined)[] = [];
    const parts: string[] = [];
    const outs = outgoing.get(n.id) ?? [];
    const ins = incoming.get(n.id) ?? [];
    const edgeDetail = (e: ModelEdge, kind: 'flow' | 'arc'): string => {
      const d: string[] = [];
      if (kind === 'flow') {
        if (e.name) {
          d.push(en ? `flow named ${quote(e.name)}` : `Fluss namens ${quote(e.name)}`);
          ids2.push(c.add('sequenceFlowName', e.key, '', e.name));
        }
        if (typeof e.attributes.condition === 'string') {
          d.push(en ? `condition ${quote(e.attributes.condition)}` : `Bedingung ${quote(e.attributes.condition)}`);
          ids2.push(c.add('condition', e.key, '', e.attributes.condition));
        }
        if (e.attributes.isDefault === true) {
          d.push(en ? 'default flow' : 'Standardfluss');
          ids2.push(c.add('defaultFlow', e.key, '', ''));
        }
      } else {
        const weight = e.attributes.weight;
        if (typeof weight === 'number' && weight !== 1) {
          d.push(en ? `weight ${String(weight)}` : `Gewicht ${String(weight)}`);
          ids2.push(c.add('arcWeight', e.key, '', String(weight)));
        }
        if (e.name) {
          d.push(en ? `named ${quote(e.name)}` : `namens ${quote(e.name)}`);
          ids2.push(c.add('label', e.key, '', e.name));
        }
      }
      if (showIds && e.id !== undefined) {
        d.push(en ? `identifier ${quote(e.id)}` : `Bezeichner ${quote(e.id)}`);
        ids2.push(c.add('identifier', e.key, '', e.id));
      }
      return d.length > 0 ? ` (${d.join(', ')})` : '';
    };
    const of = (es: ModelEdge[], side: 'source' | 'target', kind: 'flow' | 'arc' | 'plain'): string[] =>
      es.map((e) => `${ref(e[side])}${kind === 'plain' ? '' : edgeDetail(e, kind)}`);

    if (pnml) {
      const arcsIn = ins.filter((e) => e.type === 'arc');
      const arcsOut = outs.filter((e) => e.type === 'arc');
      if (arcsIn.length > 0) parts.push(en ? `Its incoming arcs come from ${list(lang, of(arcsIn, 'source', 'plain'))}` : `Seine eingehenden Kanten kommen von ${list(lang, of(arcsIn, 'source', 'plain'))}`);
      if (arcsOut.length > 0) {
        const items = of(arcsOut, 'target', 'arc');
        arcsOut.forEach((e) => ids2.push(c.add('arc', e.key, '', '')));
        parts.push(en ? `Its outgoing arcs lead to ${list(lang, items)}` : `Seine ausgehenden Kanten führen zu ${list(lang, items)}`);
      }
    } else {
      const flowsIn = ins.filter((e) => e.type === 'sequenceFlow');
      const flowsOut = outs.filter((e) => e.type === 'sequenceFlow');
      if (flowsIn.length > 0) parts.push(en ? `It is preceded by ${list(lang, of(flowsIn, 'source', 'plain'))}` : `Davor steht ${list(lang, of(flowsIn, 'source', 'plain'))}`);
      if (flowsOut.length > 0) {
        const items = of(flowsOut, 'target', 'flow');
        flowsOut.forEach((e) => ids2.push(c.add('sequenceFlow', e.key, '', '')));
        parts.push(en ? `It is followed by ${list(lang, items)}` : `Danach folgt ${list(lang, items)}`);
      }
      const msgOut = outs.filter((e) => e.type === 'messageFlow');
      const msgIn = ins.filter((e) => e.type === 'messageFlow');
      if (msgOut.length > 0) {
        const items = msgOut.map((e) => {
          ids2.push(c.add('messageFlow', e.key, '', ''));
          let d = '';
          if (e.name) {
            d = en ? ` (message named ${quote(e.name)}` : ` (Nachricht namens ${quote(e.name)}`;
            ids2.push(c.add('label', e.key, '', e.name));
          }
          if (showIds && e.id !== undefined) {
            d += `${d === '' ? ' (' : ', '}${en ? 'identifier' : 'Bezeichner'} ${quote(e.id)}`;
            ids2.push(c.add('identifier', e.key, '', e.id));
          }
          return `${ref(e.target)}${d === '' ? '' : `${d})`}`;
        });
        parts.push(en ? `It sends a message flow to ${list(lang, items)}` : `Es sendet einen Nachrichtenfluss an ${list(lang, items)}`);
      }
      if (msgIn.length > 0) parts.push(en ? `It receives a message flow from ${list(lang, of(msgIn, 'source', 'plain'))}` : `Es empfängt einen Nachrichtenfluss von ${list(lang, of(msgIn, 'source', 'plain'))}`);
      const reads = ins.filter((e) => e.type === 'dataInputAssociation');
      if (reads.length > 0) {
        reads.forEach((e) => ids2.push(c.add('dataObject', e.key, 'association', 'input')));
        parts.push(en ? `It reads from ${list(lang, of(reads, 'source', 'plain'))}` : `Es liest aus ${list(lang, of(reads, 'source', 'plain'))}`);
      }
      const writes = outs.filter((e) => e.type === 'dataOutputAssociation');
      if (writes.length > 0) {
        writes.forEach((e) => ids2.push(c.add('dataObject', e.key, 'association', 'output')));
        parts.push(en ? `It writes to ${list(lang, of(writes, 'target', 'plain'))}` : `Es schreibt in ${list(lang, of(writes, 'target', 'plain'))}`);
      }
      const assoc = outs.filter((e) => e.type === 'association');
      if (assoc.length > 0) {
        assoc.forEach((e) => ids2.push(c.add('annotation', e.key, 'association', '')));
        parts.push(en ? `It is associated with ${list(lang, of(assoc, 'target', 'plain'))}` : `Es ist verknüpft mit ${list(lang, of(assoc, 'target', 'plain'))}`);
      }
      const members = Array.isArray(n.attributes.flowNodeRefs) ? n.attributes.flowNodeRefs.map(String).filter((m) => isDescribed.has(m)) : [];
      if (n.type === 'lane' && members.length > 0) {
        members.forEach((m) => ids2.push(c.add('poolLane', n.id, 'member', m)));
        parts.push(en ? `It contains ${list(lang, members.map(ref))}` : `Sie enthält ${list(lang, members.map(ref))}`);
      }
    }
    if (parts.length > 0) {
      const joined = parts.map((x, i) => (i === 0 ? x : `${x.charAt(0).toLowerCase()}${x.slice(1)}`)).join('; ');
      sentence(joined, ids2);
    }
    text += '\n';
  };

  for (const n of nodes) describeNode(n);
  return { kind: 'text', text, facts: c.facts(), spans };
}

const L = (de: string, en: string): { de: string; en: string } => ({ de, en });

export const verbalizationGenerator: GeneratorDefinition = {
  id: 'verbalization',
  name: L('Verbalisierung', 'Verbalization'),
  description: L(
    'Regelbasierte Beschreibung in Sätzen, Element für Element (FA-25, docs/verbalization.md).',
    'Rule-based description in sentences, element by element (FA-25, docs/verbalization.md).',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'text',
  extension: 'txt',
  mime: 'text/plain',
  options: [
    {
      type: 'choice',
      key: 'language',
      label: L('Sprache', 'Language'),
      description: L('Sprache der erzeugten Sätze.', 'Language of the generated sentences.'),
      default: 'en',
      values: [
        { value: 'en', label: L('Englisch', 'English') },
        { value: 'de', label: L('Deutsch', 'German') },
      ],
    },
    {
      type: 'boolean',
      key: 'showIdentifiers',
      label: L('Bezeichner ausgeben', 'Show identifiers'),
      description: L(
        'Gibt die Bezeichner (ids) aus der Datei mit aus. Ohne sie bleiben Kennungen der Elemente im Text unerwähnt.',
        'Also states the identifiers (ids) from the file. Without them the element ids are not mentioned in the text.',
      ),
      default: false,
    },
  ],
  generate: (model, options) => verbalize(model, options),
};

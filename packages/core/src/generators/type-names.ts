import type { EdgeType, NodeType } from '../model.js';

/**
 * German names of the node and edge types, used by the German structure report. The English report keeps the
 * identifiers of the model, which are English terms already. "Transition" is the established German term in the
 * Petri net literature.
 */
const NAMES_DE: Record<NodeType | EdgeType, string> = {
  process: 'Prozess',
  collaboration: 'Kollaboration',
  participant: 'Teilnehmer',
  lane: 'Bahn',
  task: 'Aufgabe',
  userTask: 'Benutzeraufgabe',
  serviceTask: 'Serviceaufgabe',
  scriptTask: 'Skriptaufgabe',
  sendTask: 'Sendeaufgabe',
  receiveTask: 'Empfangsaufgabe',
  manualTask: 'manuelle Aufgabe',
  businessRuleTask: 'Geschäftsregelaufgabe',
  startEvent: 'Startereignis',
  endEvent: 'Endereignis',
  intermediateCatchEvent: 'fangendes Zwischenereignis',
  intermediateThrowEvent: 'werfendes Zwischenereignis',
  exclusiveGateway: 'exklusives Gateway',
  parallelGateway: 'paralleles Gateway',
  inclusiveGateway: 'inklusives Gateway',
  eventBasedGateway: 'ereignisbasiertes Gateway',
  subProcess: 'Teilprozess',
  dataObject: 'Datenobjekt',
  dataObjectReference: 'Datenobjektreferenz',
  textAnnotation: 'Textanmerkung',
  net: 'Netz',
  page: 'Seite',
  place: 'Stelle',
  transition: 'Transition',
  sequenceFlow: 'Sequenzfluss',
  messageFlow: 'Nachrichtenfluss',
  association: 'Assoziation',
  dataInputAssociation: 'Dateneingabe-Assoziation',
  dataOutputAssociation: 'Datenausgabe-Assoziation',
  arc: 'Kante',
};

/** Name of a node or edge type in the report language; English is the model identifier. */
export function typeName(type: string, lang: 'de' | 'en'): string {
  if (lang === 'en') return type;
  return (NAMES_DE as Record<string, string>)[type] ?? type;
}

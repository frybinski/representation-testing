/**
 * German short descriptions of the example models (H75). `examples/README.md` stays the English source of provenance and of the English
 * descriptions; this manifest holds the German counterpart of each first sentence. A test requires an entry for every example file.
 */
export const EXAMPLE_DESCRIPTIONS_DE: Readonly<Record<string, string>> = {
  'bpmn/order-handling.bpmn': 'Ein Prozess mit Diagrammdaten (13 Formen mit Grenzen, 13 Kanten mit Wegpunkten, Beschriftungsgrenzen, isMarkerVisible, isExpanded).',
  'bpmn/collaboration.bpmn': 'Drei Teilnehmer (zwei mit Prozessen, ein Black-Box-Pool), Nachrichtenflüsse zwischen den Prozessen und zum Black-Box-Pool, Bahnen mit einer verschachtelten Bahn, Sende-, Empfangs-, manuelle und Geschäftsregelaufgaben, ereignisbasiertes und inklusives Gateway, Nachrichten-, Timer-, Signal-, Eskalations- und Fehlerereignisse.',
  'pnml/producer-consumer.pnml': 'Stellen/Transitionen-Netz (ptnet) mit einer gewichteten Kante, Anfangsmarkierungen, einer verschachtelten Seite und PNML-Grafikangaben.',
  'pnml/pm4py-dialect.pnml': 'Netz im Dialekt von pm4py: Typ pnmlcoremodel, finalmarkings, stille Transitionen über toolspecific, numerische Kanten-Kennungen.',
  'pnml/wf-sound.pnml': 'Workflow-Netz, sound.',
  'pnml/wf-deadlock.pnml': 'Workflow-Netz mit einem Deadlock, nicht sound.',
  'pnml/wf-large.pnml': 'Workflow-Netz mit einem Zustandsraum weit über jeder sinnvollen Grenze (Soundness: nicht entschieden).',
};

# Übergabe Etappe A

Stand: Etappe A (Gerüst, Modell und Fakten, BPMN- und PNML-Parser, Formaterkennung, Beispiele) ist umgesetzt. Nicht enthalten, wie beauftragt: Erzeuger, Rückleser, Inventar, Strukturbericht, Kennzahlen, CLI, Oberfläche.

Einstieg für Etappe B: `README.md` (Aufbau, Befehle), `docs/model.md` (Modell, Fakten, Identität, Meldungen), `docs/model.schema.json`, `packages/core/src/model.ts`, `examples/README.md`.

Prüfen: `docker exec repr-werkbank npm run check` (Typprüfung, Lint, Tests).

## H-Punkte

**H1 – GitLab statt GitHub.** Das Repo liegt auf gitlab.kit.edu; `Planung.md` verlangt für M2 eine Veröffentlichung über GitHub Pages (R-1). Bis M2 ohne Auswirkung. Entscheidung von Fabian offen.

**H2 – Entwicklung im Devcontainer.** Auf dem Rechner war kein Node installiert. Entwickelt wird im Devcontainer (`.devcontainer/devcontainer.json`, Image `node:26.13.0-bookworm`, Commit `de16cea`). Image und npm-Cache liegen außerhalb des Repos; das weicht von §12 ab und ist von Fabian so gewählt.

**H3 – Rechteinhaber der Lizenz (Annahme).** In `LICENSE` steht „Copyright (c) 2026 Fabian Rybinski“. Ob KIT oder ein anderer Rechteinhaber eingetragen werden muss, ist nicht geprüft; Fabian muss bestätigen. Die Beispiele (`examples/LICENSE`, CC BY 4.0) nennen denselben Rechteinhaber. Beide Lizenztexte stammen aus der Quelle (SPDX bzw. creativecommons.org), kein Ersatzverweis nötig.

**H4 – Paketstruktur und Name.** Wurzelpaket `repr-werkbank` (0.1.0, privat), Kernpaket `@repr-werkbank/core`. Der Arbeitstitel ist E-1; falls der Name wechselt, genügt eine Umbenennung in `package.json` und den Imports. `@repr-werkbank/core` zeigt auf `dist/`; andere Pakete brauchen vorher `npm run build`.

**H5 – TypeScript 6.0.3 statt 7.0.2.** Die neueste Version ist 7.0.2, aber typescript-eslint 8.72.2 erlaubt nur `typescript >=4.8.4 <6.1.0`. Wechsel auf 7, sobald typescript-eslint es zulässt.

**H6 – Bibliotheksversionen** (an der Registry geprüft): vitest 5.1.0, eslint 10.14.0, @eslint/js 10.0.1, typescript-eslint 8.72.2, globals 17.14.0, @types/node 26.6.6, ajv 8.20.0 (nur Tests: Schema-Validierung), saxes 6.0.0 (Laufzeit). `npm audit` meldet ein Problem mittlerer Schwere in minimatch innerhalb der ESLint-Entwicklungsabhängigkeiten; es betrifft nur Entwicklung, nicht die Laufzeit, und ist nicht behoben.

**H7 – XML-Bibliothek saxes 6.0.0 (§7).** Gründe: ISC-Lizenz, reines JavaScript ohne DOM und Netzwerk, kleine Abhängigkeitsmenge (nur `xmlchars`), strikt wohlgeformt (Fehler mit Zeile/Spalte), Namensräume aufgelöst, Dokumentreihenfolge als Ereignisstrom, Position nach jedem Tag lesbar. Daraus berechnet der Parser für jedes Element den Bereich `[start, end)` im Originaltext (`loc`), den FA-20/FA-21 in Etappe B verwenden können. Schwäche: letzte Veröffentlichung 2022-05 (Pflegezustand ruhig, wird aber von jsdom eingesetzt). Verworfen: fast-xml-parser 5.12.0 (keine Positionen), @xmldom/xmldom 0.9.12 (DOM-artig, weniger Strenge bei Positionen), sax 1.6.1 (nachsichtig, nicht strikt). Nicht getestet: Zeichen außerhalb der BMP und einzelnes `\r` in Positionsangaben; `\r\n` ist getestet.

**H8 – Erweiterungselemente und werkzeugspezifische Daten (Planung regelt es nicht).** Elemente und Attribute aus fremden Namensräumen sowie PNML-`toolspecific` werden nicht ins Modell übernommen, aber als Meldung `extension` (Namensraum, Typ, ID, Zeile) gemeldet und nicht betreten. Begründung: FA-04 verbietet stilles Verwerfen; sie zu interpretieren wäre Spekulation. Ausnahme: der pm4py-Marker für stille Transitionen (`tool="ProM"`, `activity="$invisible$"`) wird ausgewertet. `extensionElements` ist nur ein Wrapper; seine Kinder werden einzeln betrachtet. Nicht gemeldet: `xmlns`/`xsi`-Attribute, DI-IDs, redundante `incoming`/`outgoing`, Attribute des Wurzelelements (`definitions`, `pnml`; Dokumentmetadaten, H9).

**H9 – Metadaten der Wurzel nicht getragen.** `id`, `name`, `targetNamespace`, `exporter` usw. des Wurzelelements sind keine Fakten nach FA-50 und werden weder getragen noch gemeldet. Falls ein Erzeuger sie ausgeben soll, muss die Kategorie ergänzt werden.

**H10 – Elemente ohne ID.** Die ID ist in BPMN und PNML nicht überall Pflicht. Der Parser vergibt `anon_<Typ>_<k>` (k je Typ in Dokumentreihenfolge, kollisionsfrei), setzt `idExplicit = false` und erzeugt keinen `identifier`-Fakt. Kanten werden über `[Quelle, Ziel]` (bei Mehrfachkanten gleichen Typs mit Vorkommen ≥ 2) identifiziert, nicht über ihre ID; die Kanten-ID ist nur ein `identifier`-Fakt. Folge: Mermaid-ähnliche Texte ohne Kanten-IDs bleiben vergleichbar. Grenze: Ein Erzeuger, der für ID-lose Knoten eigene IDs erfindet, trifft nicht `anon_…`; Etappe B muss das beim Rückleser berücksichtigen (z. B. IDs ID-loser Knoten nur strukturell vergleichen oder immer `anon_…` ausgeben).

**H11 – Seiten in PNML.** Netz und Seiten sind Knoten (`net`, `page`) mit nur `label`-, `identifier`- und `layout`-Fakten. Die Verschachtelung ist `parent`, aber kein Fakt: sie ändert das Verhalten des Netzes nicht. Falls sie als Fakt gebraucht wird, ist das eine Ergänzung in `deriveFacts`.

**H12 – Nur das erste Netz.** Enthält eine PNML-Datei mehrere `net`-Elemente, wird nur das erste modelliert; die übrigen werden samt Inhalt als nicht unterstützt gemeldet.

**H13 – Netztyp.** Akzeptiert: `ptnet`, `pnmlcoremodel` oder keine Angabe. Die URI `ptNetb` ließ sich an der Quelle nicht abrufen (HTTP 403) und wird nicht akzeptiert (Fehler `unsupported-net-type`). Andere Netztypen sind Fehler, nicht Meldung, weil das Netz sonst falsch gelesen würde.

**H14 – Kantentypen in PNML.** Bögen mit `arctype` ≠ normal (inhibitor, reset, read) werden gemeldet und nicht als einfache Kante eingelesen; Referenzknoten (`referencePlace`, `referenceTransition`) sind nicht unterstützt (auch die daran hängenden Bögen werden gemeldet). Richtig melden statt falsch darstellen.

**H15 – BPMN-Spezifikation über Spiegel.** Die offiziellen OMG-URLs für die XSDs lieferten 404; geprüft wurden `Semantic.xsd` und `BPMNDI.xsd` aus `bpmn-io/bpmn-moddle` (`resources/bpmn/xsd/`). Ein Abgleich mit der OMG-Fassung steht aus.

**H16 – Strenge bei einzelnen Attributen.** Attribute, die das Modell nicht trägt und die vom Standardwert abweichen, werden gemeldet (`unsupported-attribute`, z. B. `exclusiveGateway@gatewayDirection`). `isExecutable` am Prozess wird immer gemeldet. Das erzeugt bei vielen Modellierungswerkzeug-Exporten Meldungen; gewollt, weil sonst Information stillschweigend wegfällt.

**H17 – Keine Fakten für Standardwerte.** Kantengewicht 1, Markierung 0 und Standardattribute erzeugen keinen Fakt. Ein Erzeuger darf sie ausgeben, der Rückleser darf sie nicht als Fakt zurückgeben.

**H18 – Nicht unterstützt, gemeldet:** `boundaryEvent`, `callActivity`, Ereignis-Teilprozesse (`triggeredByEvent="true"`, Typ `eventSubProcess`), `complexGateway`, `group`, `dataStoreReference`, `ioSpecification`, `documentation`, Schleifen-/Multi-Instanz-Merkmale, Wurzelelemente (`message`, `signal`, …), Inhalte von Ereignisdefinitionen (z. B. `timeDuration`) werden als `unsupported-element` gemeldet; als Fakt bleibt nur die Art (`eventType`). Beispieldatei: `packages/core/test/fixtures/unsupported-elements.bpmn`.

**H19 – Beispiel-Netze nur von Hand begründet.** Soundness-Eigenschaften der drei Workflow-Netze sind von Hand begründet und als „nicht maschinell geprüft“ gekennzeichnet (`examples/README.md`). Die Zustandsgrenze legt Etappe C fest. Das große Netz (`wf-large.pnml`) wurde mit einem Wegwerf-Skript erzeugt, das nicht im Repo liegt. Das pm4py-Beispiel ist von Hand nach dem geprüften Format geschrieben, nicht von pm4py erzeugt.

**H20 – Quelltext im Modell (Etappe B).** `ProcessModel` hat jetzt das Feld `source` (der Text, der an `parseModel` ging). Gewählt wurde die Erweiterung des Modells statt einer erweiterten Erzeuger-Eingabe: Die `loc`-Offsets sind nur zusammen mit ihrem Text etwas wert; so bleibt die Signatur der Erzeuger `(Modell, Optionen)` wie in §5.3, und ein Modell kann nicht mit dem falschen Text kombiniert werden. Preis: Das Modell ist größer (Text doppelt im Speicher) und `source` gehört nicht in das Gesamtpaket (FA-72), dort wird es weggelassen. Es gibt keinen anderen Weg, ein `ProcessModel` zu erzeugen als `parseModel`. Schema, `docs/model.md` und Schema-Sync-Test sind nachgezogen.

**H21 – `toolRanges` (Etappe B).** `layoutRanges` enthält bei PNML nur `graphics`, nicht `toolspecific` (Hinweis 6 der Übergabe stimmte). Neu: `toolRanges` mit den äußersten `toolspecific`-Elementen und dem Kennzeichen `silentMarker` für den pm4py-Marker einer stillen Transition. Es wird in einem eigenen Durchlauf über den XML-Baum gesammelt, nicht in `readGraphics`, damit auch `toolspecific` an Stellen erfasst wird, die der Parser nur als `extension` meldet. Bei BPMN ist die Liste leer.

**H22 – Stille Übergänge in FA-21 (Etappe B).** Vorgabe folgt dem Wortlaut des Auftrags: Alle `toolspecific`-Elemente entfallen, damit auch der pm4py-Marker; die Transition wird dann beim Rücklesen sichtbar. Der Erzeuger `original-no-layout` meldet in diesem Fall `silentTransition` nicht als getragen (berechnet aus `toolRanges`, vom Test gegen `parseModel(erzeugterText)` geprüft), und das Inventar zeigt die Zelle als „nicht enthalten“. Die Option `keepSilentMarkers` (Vorgabe aus) behält die Marker; dann ist der Fakt getragen. Begründung: Der Auftrag nennt Werkzeugangaben ausdrücklich; die Bedeutungsänderung wird nicht verschwiegen, sondern im Inventar sichtbar und per Option vermeidbar. Fabian kann die Vorgabe umdrehen (eine Zeile in `original.ts`).

**H23 – Leerraum nach dem Schneiden (Etappe B).** Überlappende oder nur durch Leerzeichen/Tabs getrennte Bereiche derselben Zeile werden vereinigt. Steht ein vereinigter Bereich allein auf seiner Zeile (nur Leerraum davor und danach), entfällt die ganze Zeile samt Zeilenende; sonst wird genau der Bereich entfernt. Bereits vorhandene Leerzeilen bleiben unverändert. Die Spans der getragenen Fakten werden auf den geschnittenen Text umgerechnet.

**H24 – Knoten und Kanten ohne Id (Etappe B).** `anon_<typ>_<k>` ist ein erfundener Bezeichner. Kein Erzeuger meldet dafür einen `identifier`-Fakt, kein Rückparser erzeugt einen. Das gilt auch, wenn ein Original diese Id wörtlich enthält (dann ist der Fakt nicht getragen; Preis: ein sehr unwahrscheinlicher Verlust zugunsten der Eindeutigkeit). JSON kennzeichnet erzeugte Ids mit `idGenerated`.

**H25 – Texterzeuger und ihr Format (Etappe B).** JSON, Kompaktnotation, Mermaid und Verbalisierung sind eigene Formate (E-3, keine Vorlagen), dokumentiert in `docs/json-representation.md` (mit JSON Schema und Test), `docs/compact-notation.md`, `docs/mermaid-representation.md`, `docs/verbalization.md`, Register/Kombination/Inventar in `docs/generators.md`. Kompaktnotation gilt nur für PNML (§5.6); die übrigen für BPMN und PNML. Der Kern kennt eine Schnittstelle `TextNotation` für die zweite Notation (E-4).

**H26 – Was Mermaid trägt (Etappe B).** Keine Seitenkanäle: Mermaid trägt nur, was im Flowchart-Text steht (Knoten, Typ soweit die Form eindeutig ist, Beschriftung, Kanten, Flussnamen, Standardfluss, Nachrichtenflüsse, Datenassoziationen, Gewichte). Nicht getragen: Bedingungen, Ereignisdefinitionen, Pool/Lane-Zugehörigkeit, Layout, Kanten-Ids, bei PNML Markierungen. Ids, die Mermaid nicht verträgt (oder reserviert sind, z. B. `end`), werden zu `e__…` kodiert und beim Lesen zurückgewonnen; Beschriftungen mit Sonderzeichen als `#N;`-Entities. Kanten, deren Vorkommensnummer ein Leser nicht aus der Reihenfolge ableiten könnte, werden als `-..-` ohne Fakten gezeichnet. Geprüft wurde mit dem echten `mermaid.parse` (12.3.0, unter jsdom); das Rendern wurde nicht geprüft.

**H27 – Verbalisierung (Etappe B).** Vorgabe `showIdentifiers` aus, damit der Text so aussieht, wie man ihn einem Sprachmodell gibt; dann ist `identifier` nicht getragen. Namen stehen als JSON-Zeichenketten in Anführungszeichen. Ist ein Name nicht eindeutig oder fehlt, bekommt das Element einen Alias „Typwort k“, der in seinem eigenen Satz eingeführt wird. Kantenfakten werden nur am ausgehenden Ende gemeldet, die eingehende Erwähnung meldet nichts. Es gibt keinen Rückparser (nicht verlangt, FA-52 nennt nur Mermaid, JSON, Kompakt); die Zuordnung ist durch Tests auf Teilmenge und Wertnennung im Satz abgesichert, relationale Fakten nur durch Beispiele.

**H28 – Abhängigkeiten (nur dev, Etappe B).** `mermaid` 12.3.0 (MIT), `jsdom` 31 (MIT) und `@types/jsdom` (MIT) dienen ausschließlich dem Gültigkeitstest der Mermaid-Ausgabe, `ajv` dem Schema-Test von JSON. Der Kern (`src`) hat weiterhin nur `saxes`.

**H29 – Rückparser-Test (Etappe B).** Der JSON-Leser nutzt `deriveFacts` (die gemeinsame Faktdefinition), der Test belegt dort daher nur verlustfreies Serialisieren, nicht eine unabhängige Faktableitung. Kompakt- und Mermaid-Leser lesen nur den Text.

## Hinweise für spätere Etappen

* `source` (H20) ist im Gesamtpaket (FA-72) wegzulassen; `computeInventory(registry, model)` liefert die Matrix für FA-50 und `combine` den Baustein für FA-71.

* FA-21 für PNML (ohne Grafik und Werkzeugdaten) würde den pm4py-Marker für stille Transitionen entfernen und damit die Bedeutung ändern. Entweder den Marker behalten oder die stille Transition anders kennzeichnen; die `loc`-Bereiche und `layoutRanges` erlauben das gezielte Herausschneiden.
* pm4py schreibt Kanten-IDs als `hash(arc)` und `localNodeID` zufällig: Ausgaben von pm4py sind nicht byte-stabil; der Parser trägt `localNodeID` bewusst nicht.
* `loc.start`/`loc.end` sind UTF-16-Indizes in genau den Text, der an `parseModel` ging (ein BOM zählt mit).
* Fakten sind nach Dokumentreihenfolge sortiert, ihre Identität ist es nicht: für Gleichheit immer `sameFacts`/`diffFacts` verwenden.
* `packages/cli` und `packages/web` fehlen bewusst; `packages/*` genügt als Workspace.

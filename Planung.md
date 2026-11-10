# Auftrag: Werkbank für Repräsentationen von Prozessmodellen (Eingabeseite)

**Stand:** 10.11.2026 · **Auftraggeber:** Fabian Rybinski · **Arbeitstitel:** Repräsentations-Werkbank (englisch: Process Model Representation Workbench) · **Zielgruppe dieses Dokuments:** ein Coding-Agent, der das Werkzeug baut.

Dieses Dokument ist eigenständig lesbar. Wo es eine Entscheidung offen lässt, steht ein Standard, mit dem der Agent weiterarbeiten kann (Abschnitt 11).

## 1 Kontext

Die Dissertation untersucht die Schnittstelle zwischen Prozessmodellen und LLMs. Auf der Eingabeseite geht es um die Frage, in welcher Form ein Prozessmodell einem LLM vorgelegt wird. Die Studie „Copy That?" (ER 2026 Workshops, DOI 10.1007/978-3-032-40377-3_3) zeigt für BPMN, dass dieselbe Information je nach Repräsentationsform sehr unterschiedlich gut interpretiert wird. Eine zweite, kleinere Studie überträgt das auf Petri-Netze.

Bisher entstehen die Repräsentationen in der Experimentpipeline `llm_pmx`. Es fehlt ein Werkzeug, mit dem sich ein einzelnes Prozessmodell ansehen lässt: Wie sieht es in jeder Repräsentationsform aus, wie viel Kontext kostet jede Form, und welche Information trägt sie überhaupt. Der letzte Punkt geht auf einen Einwand aus dem Workshop zurück: Ein gerendertes Diagramm enthält möglicherweise weniger Information als die Datei, aus der es erzeugt wurde.

## 2 Ziel und Nicht-Ziele

**Ziel.** Ein kleines Webwerkzeug, das ein Prozessmodell einliest, es deterministisch in mehrere Repräsentationsformen überführt, diese nebeneinander zeigt, je Form Kennzahlen und ein Informationsinventar berechnet und die Ergebnisse exportiert.

**Zwei Verwendungen.**

1. Eigene Untersuchung von Prozessmodellen, Modellierungssprachen und Formaten (Fabian, betreute Studierende).
2. Öffentliches Begleitmaterial zur Dissertation und zu den Publikationen. Leser können die Formate an eigenen Modellen nachvollziehen.

**Nicht-Ziele.** Das Werkzeug befragt kein LLM, es ist kein Modellierungseditor und keine Experimentierplattform. Einzelheiten in Abschnitt 10.

## 3 Rahmenbedingungen

| Nr. | Vorgabe |
|---|---|
| R-1 | Statische Webanwendung ohne Backend. Auslieferung über GitHub Pages aus dem Repository. |
| R-2 | Alle Verarbeitung im Browser. Kein Modell, kein Text und keine Kennzahl verlässt den Rechner. Keine Analytik, keine Cookies, keine Schriften oder Skripte von fremden Servern zur Laufzeit. Alle Abhängigkeiten werden mitgebaut. |
| R-3 | TypeScript, Build mit Vite, Tests mit Vitest. Ein UI-Framework ist erlaubt, aber nicht verlangt. |
| R-4 | Trennung in eine **Kernbibliothek** ohne DOM-Abhängigkeit (Einlesen, internes Modell, Erzeuger, Kennzahlen, Inventar) und eine **Oberfläche**. Die Kernbibliothek läuft auch unter Node. |
| R-5 | Jede Ausgabe ist deterministisch. Gleiche Eingabe und gleiche Optionen ergeben byteweise dieselbe Ausgabe, unabhängig von Browser und Laufzeit. |
| R-6 | Oberfläche zweisprachig (Deutsch und Englisch, umschaltbar). Code-Kommentare und Dokumentation im Repository auf Englisch, `HANDOVER.md` auf Deutsch. |
| R-7 | Offene Lizenz für den Code. Die Wahl trifft Fabian (Abschnitt 11). |

## 4 Begriffe

- **Repräsentation:** eine Form, in der ein Prozessmodell als Text oder Bild vorliegt (zum Beispiel BPMN-XML, Mermaid, JSON, Verbalisierung, Diagramm).
- **Fakt:** eine kleinste Aussage über das Modell, zum Beispiel „Knoten n1 existiert", „n1 ist ein exklusives Gateway", „n1 trägt das Label …", „es gibt eine Kante von n1 nach n2", „diese Kante trägt die Bedingung …". Das interne Modell lässt sich vollständig als Menge von Fakten schreiben.
- **Informationsinventar:** je Repräsentation die Angabe, welche Fakten des Modells sie trägt.
- **Strukturbericht:** deterministisch berechnete Eigenschaften des Modells (Größe, Verzweigungen, Schleifen, Korrektheitsprüfungen). Er ist keine Repräsentation des Modells, lässt sich aber mit einer Repräsentation kombinieren.
- **Prompt-Baustein:** eine oder mehrere Repräsentationen, in fester Reihenfolge zusammengesetzt, mit Kopfzeile zur Herkunft, fertig zum Einfügen in einen Prompt.

## 5 Funktionale Anforderungen

### 5.1 Eingabe

| Nr. | Anforderung |
|---|---|
| FA-01 | Einlesen von **BPMN 2.0 XML** und **PNML** per Dateiauswahl, Ziehen und Ablegen oder Einfügen von Text. Das Format wird automatisch erkannt. |
| FA-02 | BPMN-Umfang: Aufgaben aller Typen, Start-, End- und Zwischenereignisse mit Ereignisdefinition, exklusive, parallele, inklusive und ereignisbasierte Gateways, Sequenzflüsse mit Namen und Bedingungen, Default-Flow, Pools, Lanes, Nachrichtenflüsse, Datenobjekte mit Assoziationen, Textannotationen, eingebettete Teilprozesse. Mehrere Prozesse in einer Datei werden unterstützt. |
| FA-03 | PNML-Umfang: Stellen-Transitions-Netze mit Stellen, Transitionen, Kanten, Kantengewichten, Anfangsmarkierung, verschachtelten Seiten. Zusätzlich der Dialekt von pm4py (Endmarkierung, stille Transitionen). |
| FA-04 | Elemente, die das Werkzeug nicht versteht, werden gezählt und mit Typ und Kennung in einer Meldung genannt. Nichts wird stillschweigend verworfen. Eine nicht lesbare Datei führt zu einer Fehlermeldung mit Zeile und Ursache. |
| FA-05 | Mitgelieferte Beispielmodelle (mindestens zwei BPMN, zwei Petri-Netze), sichtbar als Beispiele gekennzeichnet. Beim ersten Öffnen ist ein Beispiel geladen. Die Beispiele sind selbst erstellt oder frei lizenziert, die Herkunft steht im Repository. |

### 5.2 Internes Modell

| Nr. | Anforderung |
|---|---|
| FA-10 | Ein gemeinsames internes Modell für beide Formalismen: typisierter Graph aus Knoten und Kanten mit Attributen, dazu die Faktenmenge nach Abschnitt 4. Das Schema ist als TypeScript-Typ und als JSON-Schema dokumentiert. |
| FA-11 | Jeder Fakt hat eine stabile Kennung und eine Kategorie (Abschnitt 5.6). Reihenfolgen im Modell sind festgelegt (Dokumentreihenfolge der Eingabe), damit R-5 gilt. |

### 5.3 Repräsentationen

Jeder Erzeuger ist eine reine Funktion `(Modell, Optionen) → { Text oder Bild, Menge der getragenen Fakten }`.

| Nr. | Repräsentation | BPMN | Petri-Netz |
|---|---|---|---|
| FA-20 | Originaldatei, unverändert | ja | ja |
| FA-21 | Originalformat ohne Layoutangaben (BPMN ohne Diagramm-Interchange, PNML ohne Grafik- und Werkzeugangaben), sonst unverändert | ja | ja |
| FA-22 | Mermaid (Flussdiagramm-Syntax) | ja | ja |
| FA-23 | JSON nach dokumentiertem Schema (Knoten, Kanten, Attribute) | ja | ja |
| FA-24 | Kompakte Textnotation für Petri-Netze (Stellen, Transitionen, Kanten, Markierung in wenigen Zeilen). Die Grammatik wird im Repository festgehalten. Die Notation ist austauschbar angelegt, weil eine zweite Notation aus der Forschungsgruppe dazukommen soll (Abschnitt 11). | nein | ja |
| FA-25 | Regelbasierte Verbalisierung in Deutsch und Englisch, ohne LLM. Elementweise: je Knoten ein bis zwei Sätze zu Typ, Label, Vorgängern, Nachfolgern und Bedingungen. Jeder Satz ist den Fakten zugeordnet, die er ausdrückt. | ja | ja |
| FA-26 | Diagramm als SVG, exportierbar als PNG in wählbarer Auflösung. Layout aus der Datei, wenn vorhanden, sonst automatisches Schichtenlayout. Die Wahl ist umschaltbar. Übliche Symbolik (BPMN-Formen, Stellen als Kreise, Transitionen als Rechtecke, Marken als Punkte). | ja | ja |
| FA-27 | Strukturbericht als Text und als JSON (Abschnitt 5.4), allein oder als Zusatz zu einer Repräsentation | ja | ja |
| FA-28 | Kombinationen: frei wählbare Folge von Repräsentationen, zum Beispiel Verbalisierung plus Mermaid oder JSON plus Strukturbericht | ja | ja |

Hinweis für die Dokumentation: In „Copy That?" waren die natürlichsprachlichen Beschreibungen von Hand erstellt. Die Verbalisierung dieses Werkzeugs ist regelbasiert erzeugt und damit eine andere Bedingung. Das steht auf der Seite „Über".

### 5.4 Strukturbericht

| Nr. | Anforderung |
|---|---|
| FA-30 | Für beide Formalismen: Zahl der Knoten je Typ, Zahl der Kanten, Start- und Endknoten, Verzweigungen und Zusammenführungen mit Ein- und Ausgangsgrad, Schleifen (Zyklen mit ihren Knoten), nicht verbundene Teile, Knoten ohne Label. |
| FA-31 | Zusätzlich für BPMN: Gateways je Art, Paare aus Verzweigung und Zusammenführung mit unterschiedlicher Art, Sequenzflüsse mit und ohne Bedingung an exklusiven Gateways, Default-Flows. |
| FA-32 | Zusätzlich für Petri-Netze: Prüfung auf Workflow-Netz (genau eine Quell- und eine Senkenstelle, jeder Knoten auf einem Pfad dazwischen), Free-Choice-Eigenschaft, stille Transitionen. Für Workflow-Netze eine Soundness-Prüfung über den Erreichbarkeitsgraphen mit Zustandsgrenze. Wird die Grenze erreicht, lautet das Ergebnis „nicht entschieden", nie „sound". |
| FA-33 | Gängige Strukturmetriken: Größe, Dichte, mittlerer und größter Konnektorgrad, Control-Flow Complexity, Anteil der Knoten in Zyklen. Jede Metrik mit Formel und Quelle in der Dokumentation. Quellen prüfen und nicht aus dem Gedächtnis angeben. |

### 5.5 Kennzahlen je Repräsentation

| Nr. | Anforderung |
|---|---|
| FA-40 | Zeichen, Zeilen und Tokenbedarf je Textrepräsentation, absolut und relativ zur Originaldatei. Für das Diagramm stattdessen Pixelmaße und Dateigröße. |
| FA-41 | Der Tokenbedarf wird mit einem echten Tokenizer berechnet, der im Browser läuft und mitgebaut ist. Der verwendete Tokenizer steht neben jeder Zahl. Der Tokenizer ist ein austauschbares Modul. |
| FA-42 | Die Oberfläche sagt an der Kennzahl, dass der Tokenbedarf vom LLM abhängt. Eine Schätzformel ohne Tokenizer ist nicht zulässig. |

### 5.6 Informationsinventar

| Nr. | Anforderung |
|---|---|
| FA-50 | Kategorien für BPMN: Knoten, Knotentyp, Label, Kennung, Sequenzfluss, Name des Sequenzflusses, Bedingung, Default-Flow, Ereignistyp, Pool und Lane, Nachrichtenfluss, Datenobjekt mit Assoziation, Annotation, Layout. Für Petri-Netze: Stelle, Transition, Label, Kennung, Kante, Kantengewicht, Anfangsmarkierung, Endmarkierung, stille Transition, Layout. |
| FA-51 | Matrix Kategorie mal Repräsentation. Jede Zelle zeigt „n von m Fakten" und einen Status (vollständig, teilweise, nicht enthalten). Kategorien, die im geladenen Modell nicht vorkommen, sind als solche gekennzeichnet. |
| FA-52 | Das Inventar wird aus den getragenen Fakten der Erzeuger berechnet, nicht aus einer festen Tabelle. Für Mermaid, JSON und die kompakte Textnotation gibt es zusätzlich einen Rückleser, der die Ausgabe wieder einliest. Ein Test prüft, dass die zurückgelesenen Fakten den gemeldeten entsprechen. |
| FA-53 | Für das Diagramm unterscheidet das Inventar zwischen „als Text lesbar" (Label) und „nur visuell kodiert" (Typ als Form, Default-Flow als Strich, Ereignistyp als Symbol). |
| FA-54 | Ein Klick auf eine Zelle listet die fehlenden Fakten mit den betroffenen Elementen. |

### 5.7 Vergleich und Erkundung

| Nr. | Anforderung |
|---|---|
| FA-60 | Zwei Ansichten nebeneinander, je mit freier Wahl der Repräsentation. Auf schmalen Bildschirmen nach UI-09. |
| FA-61 | Verknüpftes Hervorheben: Die Auswahl eines Elements in einer Ansicht hebt dasselbe Element in der anderen Ansicht hervor (Knoten im Diagramm, Zeile im Text, Satz in der Verbalisierung). Grundlage ist die Zuordnung der Fakten. |
| FA-62 | Übersichtstabelle aller Repräsentationen des geladenen Modells mit den Kennzahlen aus 5.5, sortierbar. |
| FA-63 | Optionen je Erzeuger, soweit vorhanden (Sprache der Verbalisierung, Layoutquelle, Kennungen ein oder aus, Einrückung). Geänderte Optionen wirken sofort auf Text, Kennzahlen und Inventar. |

### 5.8 Export

| Nr. | Anforderung |
|---|---|
| FA-70 | Jede Repräsentation einzeln kopieren und als Datei speichern (`.xml`, `.pnml`, `.mmd`, `.json`, `.txt`, `.svg`, `.png`). |
| FA-71 | Prompt-Baustein aus einer Kombination nach FA-28, mit optionaler Kopfzeile: Name und Version des Werkzeugs, Repräsentationen mit Optionen, SHA-256 der Eingabedatei. |
| FA-72 | Gesamtpaket als eine JSON-Datei: Metadaten, alle Repräsentationen, Kennzahlen, Inventar, Strukturbericht. Das Schema ist dokumentiert und versioniert. |
| FA-73 | Kommandozeile auf Basis der Kernbibliothek: ein Verzeichnis mit Modellen einlesen und je Modell das Gesamtpaket nach FA-72 schreiben. Gleiche Version und gleiche Optionen ergeben dieselbe Ausgabe wie die Oberfläche. |

### 5.9 Begleitmaterial

| Nr. | Anforderung |
|---|---|
| FA-80 | Seite „Über": Zweck, Bezug zur Publikation mit DOI, Zitierhinweis, Version, Verweis auf das Repository, Hinweis nach 5.3. Autor: Fabian Rybinski, Karlsruher Institut für Technologie. |
| FA-81 | Seite „Formate": je Repräsentation eine kurze Beschreibung, die Grammatik oder das Schema und ein Beispiel. |
| FA-82 | Versionsnummer nach Semantic Versioning, sichtbar in der Oberfläche und in jedem Export. Eine Änderung an der Ausgabe eines Erzeugers erhöht mindestens die Minor-Version und steht im Änderungsprotokoll. |

### 5.10 Oberfläche: Aufbau und Gestaltung

Leitlinie: übersichtlich, modern, nicht überladen. Im Zweifel wird ein Bedienelement weggelassen oder eine Ebene tiefer gelegt. Die Oberfläche zeigt im Grundzustand das Prozessmodell in zwei Repräsentationen und sonst wenig.

```
+--------------------------------------------------------------------+
| Name   Modell: beispiel.bpmn  [Laden] [Beispiele]     DE|EN  ◐  Über |
+--------------------------------+-----------------------------------+
| [Repräsentation ▾]   ⚙  ⧉  ⭳   | [Repräsentation ▾]   ⚙  ⧉  ⭳      |
|                                |                                   |
|   Ansicht A                    |   Ansicht B                       |
|                                |                                   |
| 1.240 Zeichen · 48 Z. · 412 T. | 5.310 Zeichen · 160 Z. · 1.730 T. |
+--------------------------------+-----------------------------------+
| Übersicht | Inventar | Strukturbericht | Export          (eingeklappt)|
+--------------------------------------------------------------------+
```

| Nr. | Anforderung |
|---|---|
| UI-01 | Eine Seite mit einem Arbeitsbereich. Drei Zonen: schmale Kopfzeile, zwei Ansichten, darunter ein einklappbarer Bereich mit Reitern (Übersicht nach FA-62, Inventar, Strukturbericht, Export). „Über" und „Formate" sind eigene Seiten. |
| UI-02 | Grundzustand: Der untere Bereich ist eingeklappt. Sichtbar sind die Kopfzeile, beide Ansichten und je Ansicht eine Kennzahlenzeile (Zeichen, Zeilen, Tokenbedarf). Alles Weitere öffnet der Nutzer selbst. Es ist immer höchstens ein Reiter geöffnet. |
| UI-03 | Kopfzeile mit höchstens sechs Bedienelementen: Laden, Beispiele, Sprache, Farbschema, Über, Formate. Der Name des geladenen Modells steht als Text daneben. |
| UI-04 | Je Ansicht eine Leiste mit der Wahl der Repräsentation und höchstens drei Symbolknöpfen (Optionen, Kopieren, Speichern). Die Optionen nach FA-63 öffnen sich als kleines Feld an der Ansicht, nicht als eigene Seite und nicht als dauerhaft sichtbare Spalte. |
| UI-05 | Typografie: eine serifenlose Schrift für die Oberfläche, eine Festbreitenschrift für Textrepräsentationen. Höchstens vier Schriftgrößen, feste Abstandsskala (Vielfache von 4 Pixel). Viel Weißraum, keine Rahmen um Rahmen. Trennung über Abstand und dezente Linien statt über Kästen und Schatten. |
| UI-06 | Farbe: neutrale Flächen, eine Akzentfarbe für Auswahl und Hervorhebung. Statusfarben nur im Inventar, dort immer zusammen mit Symbol oder Text (nicht allein über Farbe). Helles und dunkles Farbschema folgen der Systemeinstellung und sind umschaltbar. Farben, Schriftgrößen und Abstände stehen als benannte Werte an einer Stelle. |
| UI-07 | Textansichten: Zeilennummern, zurückhaltende Syntaxhervorhebung, Zeilenumbruch umschaltbar. Diagrammansicht: Zoomen, Verschieben, „Einpassen". Keine weiteren Werkzeugleisten. |
| UI-08 | Zustände sind gestaltet: Laden, Fehler beim Einlesen, Meldung nach FA-04, Kategorie kommt im Modell nicht vor. Meldungen erscheinen als nicht blockierende Leiste unter der Kopfzeile. Keine Dialogfenster für Routinevorgänge. |
| UI-09 | Schmale Bildschirme: Die beiden Ansichten liegen als Reiter übereinander, der untere Bereich bleibt eingeklappt erreichbar. Symbolknöpfe haben eine Beschriftung für Vorlesehilfen und einen Tooltip. |
| UI-10 | Keine Einführungstour, keine Werbebanner, keine Zähler oder Abzeichen, keine Bewegung außer kurzen Übergängen beim Ein- und Ausklappen (abschaltbar über die Systemeinstellung für reduzierte Bewegung). |
| UI-11 | Vorgehen: Vor dem Ausbau der Oberfläche legt der Agent einen Gestaltungsentwurf vor. Der Entwurf zeigt drei Zustände als Bildschirmfotos (Grundzustand, geöffnetes Inventar, schmaler Bildschirm), je im hellen und dunklen Farbschema. Fabian nimmt den Entwurf ab, erst danach folgen die übrigen Funktionen von M2. |

## 6 Nichtfunktionale Anforderungen

| Nr. | Anforderung |
|---|---|
| NF-01 | Korrektheit vor Umfang. Lieber ein Element als nicht unterstützt melden als es falsch darstellen. |
| NF-02 | Modelle mit bis zu 500 Knoten werden ohne spürbare Wartezeit verarbeitet. Die Soundness-Prüfung läuft außerhalb des Haupt-Threads und ist abbrechbar. |
| NF-03 | Aktuelle Versionen von Firefox, Chrome und Safari. Nutzbar ab 400 Pixel Breite, ohne waagerechtes Scrollen der Seite. Helles und dunkles Farbschema. |
| NF-04 | Bedienung per Tastatur, sichtbarer Fokus, Kontraste nach WCAG AA, Diagramme mit Textalternative (die Verbalisierung). |
| NF-05 | Der Zustand der Oberfläche (Sprache, gewählte Ansichten, Optionen) wird lokal gemerkt. Modelle werden nicht gespeichert. |
| NF-06 | Gestaltung nach Abschnitt 5.10. Diagramme in Graustufen mit der Akzentfarbe für die Hervorhebung. |

## 7 Architektur

```
packages/core     Einlesen (bpmn, pnml), Modell, Fakten, Erzeuger, Rückleser,
                  Strukturbericht, Kennzahlen, Inventar. Keine DOM-Abhängigkeit.
packages/cli      Kommandozeile nach FA-73.
packages/web      Oberfläche, Diagrammdarstellung, Export.
examples/         Beispielmodelle mit Herkunft.
tests/golden/     Erwartete Ausgaben je Beispiel und Repräsentation.
docs/             Formate, Schemata, Metriken mit Quellen.
```

Jeder Erzeuger registriert sich mit Kennung, Namen in beiden Sprachen, unterstützten Formalismen, Optionen und Dateiendung. Die Oberfläche liest diese Registrierung und enthält keine Liste von Formaten. Ein neuer Erzeuger braucht damit keine Änderung an der Oberfläche.

Für das Einlesen von XML, das Layout und den Tokenizer dürfen etablierte Bibliotheken verwendet werden. Vor der Wahl sind Lizenz, Pflegezustand und Größe zu prüfen und in `HANDOVER.md` zu begründen.

## 8 Meilensteine und Abnahme

**M1 Kernbibliothek und Kommandozeile.** FA-01 bis FA-04 (ohne Oberfläche), FA-10, FA-11, FA-20 bis FA-25, FA-27, FA-28, FA-30 bis FA-33, FA-40 bis FA-42, FA-50 bis FA-52, FA-72, FA-73.

Abnahme M1:

- `npm test` läuft grün. Für jedes Beispielmodell und jede Textrepräsentation gibt es eine erwartete Ausgabe unter `tests/golden/`.
- Die Rückleser für Mermaid, JSON und die kompakte Textnotation liefern für jedes Beispiel genau die gemeldeten Fakten.
- Für die Originaldatei gilt in jedem Beispiel: Das Inventar ist in allen Kategorien vollständig.
- Zwei Läufe der Kommandozeile auf denselben Eingaben erzeugen identische Dateien (Vergleich per Prüfsumme).
- Ein Workflow-Netz mit bekanntem Deadlock wird als nicht sound gemeldet, ein bekanntes soundes Netz als sound, ein Netz über der Zustandsgrenze als nicht entschieden.
- Eine Datei mit einem nicht unterstützten Element erzeugt die Meldung nach FA-04.

**M2 Oberfläche und Veröffentlichung.** FA-01 und FA-05 in der Oberfläche, FA-26, FA-53, FA-54, FA-60 bis FA-63, FA-70, FA-71, FA-80 bis FA-82, UI-01 bis UI-11, NF-02 bis NF-06, Veröffentlichung über GitHub Pages per Workflow im Repository. M2 beginnt mit dem Gestaltungsentwurf nach UI-11.

Abnahme M2:

- Der Gestaltungsentwurf nach UI-11 ist von Fabian abgenommen, und die fertige Oberfläche entspricht ihm.
- Nach dem Öffnen ist ein Beispiel geladen, beide Ansichten sind gefüllt, je Ansicht steht die Kennzahlenzeile. Der untere Bereich ist eingeklappt.
- Bei 1440 mal 900 Pixel sind im Grundzustand Kopfzeile, beide Ansichten und beide Kennzahlenzeilen ohne Scrollen sichtbar. Die Kopfzeile hat höchstens sechs Bedienelemente, jede Ansicht höchstens vier.
- Inventar, Übersicht, Strukturbericht und Export sind je mit einem Klick erreichbar.
- Eine eigene BPMN-Datei und eine eigene PNML-Datei lassen sich laden. Im Netzwerkprotokoll des Browsers erscheint dabei keine Anfrage an einen fremden Server.
- Die Auswahl eines Knotens im Diagramm hebt die zugehörige Stelle in Mermaid, JSON und Verbalisierung hervor.
- Das Gesamtpaket aus der Oberfläche ist identisch mit dem der Kommandozeile für dieselbe Datei und dieselben Optionen.
- Die Seite ist bei 400 Pixel Breite und im dunklen Farbschema bedienbar.

**M3 Ausbau.** Varianten „informationsgleich zum Diagramm" (JSON und Text, die nur die Fakten tragen, die das Diagramm als Text lesbar oder visuell kodiert enthält), ablauforientierte Verbalisierung für blockstrukturierte Modelle, weitere Tokenizer, Laden mehrerer Modelle mit Vergleichstabelle, zweite Petri-Netz-Notation nach FA-24.

## 9 Tests

- Tests mit erwarteten Ausgaben je Beispiel und Repräsentation. Eine geänderte Ausgabe ist ein bewusster Schritt mit neuer Version nach FA-82.
- Eigenschaftstests auf zufällig erzeugten kleinen Modellen: Einlesen, JSON erzeugen, zurücklesen, Fakten vergleichen.
- Tests für die Fehlerfälle nach FA-04.
- Ein Test, der den gebauten Stand auf Verweise zu fremden Servern durchsucht (R-2).

## 10 Nicht Teil des Auftrags

- Anbindung an ein LLM, Prompts ausführen, Antworten bewerten. Dafür gibt es `llm_pmx`.
- Bearbeiten von Modellen, Speichern in ein anderes Modellformat, Umwandlung zwischen BPMN und Petri-Netzen.
- Process Trees, objektzentrierte Petri-Netze, höhere Petri-Netze, DMN, CMMN.
- Simulation, Token-Spiel, Conformance Checking.
- Nutzerkonten, Speicherung auf einem Server, gemeinsames Arbeiten.

## 11 Offene Entscheidungen (Fabian), mit Standard für den Agenten

| Nr. | Frage | Standard, bis entschieden ist |
|---|---|---|
| E-1 | Name des Werkzeugs und des Repositorys | Arbeitstitel, Repository `repr-werkbank` |
| E-2 | Lizenz | MIT für den Code, Beispiele unter CC BY 4.0 |
| E-3 | Abgleich mit `llm_pmx`: Sollen Mermaid und JSON byteweise den Formaten aus „Copy That?" entsprechen? Dafür braucht der Agent Beispielausgaben aus `llm_pmx`. | Eigenes, dokumentiertes Format. Abweichungen werden nachgezogen, sobald Beispiele vorliegen. |
| E-4 | Zweite Petri-Netz-Notation aus der Forschungsgruppe (FA-24) | Erst in M3, sobald die Spezifikation vorliegt |
| E-5 | Tokenizer in M1 | Ein offener, verbreiteter BPE-Tokenizer. Tokenizer der eingesetzten lokalen LLMs in M3. |
| E-6 | Impressum und Datenschutzhinweis für die öffentliche Seite | Platzhalterseite, Inhalt liefert Fabian nach den Vorgaben des KIT |
| E-7 | Standardsprache der Oberfläche | Englisch, Deutsch umschaltbar |
| E-8 | Akzentfarbe und Schrift der Oberfläche | Der Agent schlägt beides im Gestaltungsentwurf nach UI-11 vor. Schriften werden mitgebaut oder es wird die Systemschrift verwendet (R-2). |

## 12 Arbeitsregeln für den Agenten

- Je abgeschlossenem Schritt ein Commit im Repository des Werkzeugs. Außerhalb des Repositorys wird nichts geändert.
- `HANDOVER.md` im Repository führt den Stand je Meilenstein: was gebaut ist, wie es geprüft wurde, Annahmen und Abweichungen von diesem Auftrag als nummerierte Punkte (H1, H2 …) mit Begründung. Nichts wird stillschweigend anders gebaut.
- Aussagen über Bibliotheken, Formate und Metriken werden an der Quelle geprüft (Spezifikation, Dokumentation), nicht aus dem Gedächtnis übernommen.
- Wenn eine Anforderung sich beim Bau als falsch oder widersprüchlich erweist: begründet abweichen, als H-Punkt festhalten und weiterarbeiten.
- Keine Platzhalter in der veröffentlichten Seite außer der Seite nach E-6.
- Die Oberfläche wird vor jedem Bericht im Browser angesehen (Bildschirmfotos im hellen und dunklen Farbschema, breit und schmal). Ein Stand, der nur gebaut und nicht angesehen wurde, gilt nicht als fertig.
- Nach M1 und nach M2 endet die Arbeit mit einem Bericht: Abnahmepunkte aus Abschnitt 8 einzeln mit Ergebnis, offene H-Punkte, Vorschlag für den nächsten Schritt.
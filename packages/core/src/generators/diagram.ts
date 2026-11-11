import type { Fact, ProcessModel } from '../model.js';
import { bpmnAutoScene } from '../diagram/bpmn-auto.js';
import { bpmnFileScene } from '../diagram/bpmn-file.js';
import type { Direction } from '../diagram/flow-layout.js';
import { pnmlAutoScene, pnmlFileScene } from '../diagram/pnml-scene.js';
import { renderBpmn, renderPnml } from '../diagram/render.js';
import type { Scene, SceneResult } from '../diagram/scene.js';
import type { FactEncoding, GeneratorDefinition, ImageOutput, OptionValues } from './types.js';

const L = (de: string, en: string) => ({ de, en });

/** Diagram as SVG (FA-26). Layout from the file when it is complete, else automatic; see docs/diagram.md. */
export function diagramOutput(model: ProcessModel, options: OptionValues): ImageOutput {
  const direction: Direction = options.direction === 'TB' ? 'TB' : 'LR';
  const bpmn = model.formalism === 'bpmn';
  let scene: Scene | undefined;
  let fallback = '';
  if (options.layout === 'file') {
    const r: SceneResult = bpmn ? bpmnFileScene(model) : pnmlFileScene(model);
    if (r.ok) scene = r.scene;
    else fallback = r.reason;
  }
  scene ??= bpmn ? bpmnAutoScene(model, direction, fallback) : pnmlAutoScene(model, direction, fallback);
  const rendered = bpmn ? renderBpmn(model, scene, { showConditions: options.showConditions === true }) : renderPnml(model, scene);
  const facts: Fact[] = [];
  const encoding: Record<string, FactEncoding> = {};
  for (const f of model.facts) {
    const how = rendered.encoding.get(f.id);
    if (how === undefined) continue;
    facts.push(f);
    encoding[f.id] = how;
  }
  return { kind: 'image', mime: 'image/svg+xml', svg: rendered.svg, width: rendered.width, height: rendered.height, facts, encoding, layout: { source: scene.source, fallback: scene.fallback } };
}

export const diagramGenerator: GeneratorDefinition = {
  id: 'diagram',
  name: L('Diagramm (SVG)', 'Diagram (SVG)'),
  description: L(
    'Diagramm als SVG mit BPMN-Symbolen bzw. Stellen, Transitionen und Marken (FA-26). Layout aus der Datei, sonst automatisches Schichtenlayout.',
    'Diagram as SVG with BPMN symbols, or places, transitions and tokens (FA-26). Layout from the file, otherwise automatic layered layout.',
  ),
  formalisms: ['bpmn', 'pnml'],
  kind: 'image',
  extension: 'svg',
  mime: 'image/svg+xml',
  options: [
    {
      key: 'layout',
      type: 'choice',
      default: 'file',
      values: [
        { value: 'file', label: L('aus der Datei', 'from the file') },
        { value: 'auto', label: L('automatisch', 'automatic') },
      ],
      label: L('Layoutquelle', 'Layout source'),
      description: L(
        'Aus der Datei: Koordinaten der Datei, wenn sie für jedes gezeichnete Element vorhanden sind, sonst automatisch für das ganze Diagramm. Automatisch: immer Schichtenlayout.',
        'From the file: the coordinates of the file when every drawn element has them, otherwise automatic for the whole diagram. Automatic: always layered layout.',
      ),
    },
    {
      key: 'direction',
      type: 'choice',
      default: 'LR',
      values: [
        { value: 'LR', label: L('von links nach rechts', 'left to right') },
        { value: 'TB', label: L('von oben nach unten', 'top to bottom') },
      ],
      label: L('Richtung', 'Direction'),
      description: L(
        'Richtung des automatischen Layouts. Mit Pools oder Bahnen immer von links nach rechts.',
        'Direction of the automatic layout. With pools or lanes always left to right.',
      ),
    },
    {
      key: 'showConditions',
      type: 'boolean',
      default: false,
      label: L('Bedingungen anzeigen', 'Show conditions'),
      description: L(
        'BPMN: schreibt den Bedingungsausdruck von Sequenzflüssen an den Fluss. Üblich ist nur die Raute am Start des Flusses; ohne diese Option trägt das Diagramm den Ausdruck nicht.',
        'BPMN: writes the condition expression of sequence flows next to the flow. The usual notation shows only a diamond at the start of the flow; without this option the diagram does not carry the expression.',
      ),
    },
  ],
  generate: (model, options) => diagramOutput(model, options),
};

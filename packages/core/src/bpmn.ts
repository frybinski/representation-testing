import {
  ParseContext,
  childrenOf,
  fmtNum,
  parseNumber,
  requireAttr,
  type AttributeSpec,
} from './context.js';
import { deriveFacts } from './facts.js';
import {
  SCHEMA_VERSION,
  type AttributeValue,
  type EdgeType,
  type ModelEdge,
  type ModelNode,
  type NodeType,
  type ProcessModel,
} from './model.js';
import { NoticeBook } from './notices.js';
import { attr, type XmlElement } from './xml.js';

export const BPMN_MODEL_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
export const BPMN_DI_NS = 'http://www.omg.org/spec/BPMN/20100524/DI';
export const BPMN_DC_NS = 'http://www.omg.org/spec/DD/20100524/DC';
export const BPMN_DD_NS = 'http://www.omg.org/spec/DD/20100524/DI';

const NATIVE = new Set([BPMN_MODEL_NS, BPMN_DI_NS, BPMN_DC_NS, BPMN_DD_NS]);

const ACTIVITY_DEFAULTS = { isForCompensation: 'false', startQuantity: '1', completionQuantity: '1' };

const TASK_TYPES = [
  'task',
  'userTask',
  'serviceTask',
  'scriptTask',
  'sendTask',
  'receiveTask',
  'manualTask',
  'businessRuleTask',
] as const;

const EVENT_TYPES = ['startEvent', 'endEvent', 'intermediateCatchEvent', 'intermediateThrowEvent'] as const;
const GATEWAY_TYPES = ['exclusiveGateway', 'parallelGateway', 'inclusiveGateway', 'eventBasedGateway'] as const;

const EVENT_DEFINITIONS: Record<string, string> = {
  messageEventDefinition: 'message',
  timerEventDefinition: 'timer',
  errorEventDefinition: 'error',
  signalEventDefinition: 'signal',
  escalationEventDefinition: 'escalation',
  conditionalEventDefinition: 'conditional',
  linkEventDefinition: 'link',
  compensateEventDefinition: 'compensate',
  cancelEventDefinition: 'cancel',
  terminateEventDefinition: 'terminate',
};

function specFor(name: string): AttributeSpec {
  switch (name) {
    case 'receiveTask':
      return { consumed: ['name', 'default'], defaults: { ...ACTIVITY_DEFAULTS, instantiate: 'false' } };
    case 'subProcess':
      return { consumed: ['name', 'default'], defaults: { ...ACTIVITY_DEFAULTS, triggeredByEvent: 'false' } };
    case 'startEvent':
      return { consumed: ['name'], defaults: { parallelMultiple: 'false', isInterrupting: 'true' } };
    case 'intermediateCatchEvent':
      return { consumed: ['name'], defaults: { parallelMultiple: 'false' } };
    case 'endEvent':
    case 'intermediateThrowEvent':
      return { consumed: ['name'], defaults: {} };
    case 'exclusiveGateway':
    case 'inclusiveGateway':
      return { consumed: ['name', 'default'], defaults: { gatewayDirection: 'Unspecified' } };
    case 'parallelGateway':
      return { consumed: ['name'], defaults: { gatewayDirection: 'Unspecified' } };
    case 'eventBasedGateway':
      return {
        consumed: ['name'],
        defaults: { gatewayDirection: 'Unspecified', instantiate: 'false', eventGatewayType: 'Exclusive' },
      };
    default:
      return { consumed: ['name', 'default'], defaults: ACTIVITY_DEFAULTS };
  }
}

interface PendingEdge {
  el: XmlElement;
  type: EdgeType;
  source: string;
  target: string;
  parent: string;
  name?: string;
  withId: boolean;
  /** Message of the sequence flow condition etc. */
  attributes: Record<string, AttributeValue>;
}

function parseBool(ctx: ParseContext, el: XmlElement, name: string): boolean | undefined {
  const v = attr(el, name);
  if (v === undefined) return undefined;
  const t = v.trim();
  if (t === 'true' || t === '1') return true;
  if (t === 'false' || t === '0') return false;
  return ctx.fail('invalid-value', `attribute "${name}" of <${el.name}> is not a boolean: "${v}"`, el);
}

export function parseBpmn(root: XmlElement): ProcessModel {
  const ctx: ParseContext = new ParseContext(root, (uri) => uri === '' || NATIVE.has(uri));
  const pending: PendingEdge[] = [];
  const defaults: { node: ModelNode; el: XmlElement; ref: string }[] = [];
  const participantRefs: { node: ModelNode; el: XmlElement; ref: string }[] = [];
  const laneRefs: { node: ModelNode; el: XmlElement; refs: { el: XmlElement; ref: string }[] }[] = [];
  const dataRefs: { node: ModelNode; el: XmlElement; ref: string }[] = [];
  const diagrams: XmlElement[] = [];

  const isModel = (el: XmlElement): boolean => el.uri === BPMN_MODEL_NS;

  // ---- structure -----------------------------------------------------

  function containerChild(child: XmlElement, containerId: string): void {
    if (!isModel(child)) {
      ctx.report(child);
      return;
    }
    const name = child.name;
    if ((TASK_TYPES as readonly string[]).includes(name)) parseTask(child, containerId);
    else if ((EVENT_TYPES as readonly string[]).includes(name)) parseEvent(child, containerId);
    else if ((GATEWAY_TYPES as readonly string[]).includes(name)) parseGateway(child, containerId);
    else if (name === 'subProcess') parseSubProcess(child, containerId);
    else if (name === 'sequenceFlow') parseSequenceFlow(child, containerId);
    else if (name === 'dataObject') parseDataObject(child, containerId);
    else if (name === 'dataObjectReference') parseDataObjectReference(child, containerId);
    else if (name === 'textAnnotation') parseTextAnnotation(child, containerId);
    else if (name === 'association') parseAssociation(child, containerId);
    else if (name === 'laneSet') parseLaneSet(child, containerId, containerId);
    else ctx.report(child);
  }

  function parseProcess(el: XmlElement): void {
    ctx.checkAttributes(el, { consumed: ['name'], defaults: { processType: 'None', isClosed: 'false' } });
    const node = ctx.addNode(el, 'process', undefined, {}, attr(el, 'name'));
    for (const child of childrenOf(el)) containerChild(child, node.id);
  }

  function parseSubProcess(el: XmlElement, parent: string): void {
    if (parseBool(ctx, el, 'triggeredByEvent') === true) {
      ctx.report(el, 'eventSubProcess');
      return;
    }
    ctx.checkAttributes(el, specFor('subProcess'));
    const node = ctx.addNode(el, 'subProcess', parent, {}, attr(el, 'name'));
    registerDefault(node, el);
    parseHostChildren(el, node, parent, (c) => {
      containerChild(c, node.id);
    });
  }

  function registerDefault(node: ModelNode, el: XmlElement): void {
    const d = attr(el, 'default');
    if (d !== undefined && d !== '') defaults.push({ node, el, ref: d });
  }

  function parseHostChildren(el: XmlElement, host: ModelNode, container: string, onOther: (c: XmlElement) => void): void {
    for (const child of childrenOf(el)) {
      if (!isModel(child)) ctx.report(child);
      else if (child.name === 'incoming' || child.name === 'outgoing') continue;
      else if (child.name === 'dataInputAssociation' || child.name === 'dataOutputAssociation') {
        parseDataAssociation(child, host.id, container);
      } else onOther(child);
    }
  }

  function parseTask(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, specFor(el.name));
    const node = ctx.addNode(el, el.name as NodeType, parent, {}, attr(el, 'name'));
    registerDefault(node, el);
    parseHostChildren(el, node, parent, (c) => ctx.report(c));
  }

  function parseGateway(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, specFor(el.name));
    const node = ctx.addNode(el, el.name as NodeType, parent, {}, attr(el, 'name'));
    registerDefault(node, el);
    for (const child of childrenOf(el)) {
      if (isModel(child) && (child.name === 'incoming' || child.name === 'outgoing')) continue;
      ctx.report(child);
    }
  }

  function parseEvent(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, specFor(el.name));
    const definitions: string[] = [];
    const node = ctx.addNode(el, el.name as NodeType, parent, {}, attr(el, 'name'));
    parseHostChildren(el, node, parent, (c) => {
      const kind = EVENT_DEFINITIONS[c.name];
      if (kind === undefined) {
        ctx.report(c);
        return;
      }
      ctx.checkAttributes(c, { consumed: [], defaults: {} });
      definitions.push(kind);
      for (const sub of childrenOf(c)) ctx.report(sub);
    });
    if (definitions.length > 0) node.attributes.eventDefinitions = definitions;
  }

  function parseSequenceFlow(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['name', 'sourceRef', 'targetRef'], defaults: {} });
    const attributes: Record<string, AttributeValue> = {};
    for (const child of childrenOf(el)) {
      if (isModel(child) && child.name === 'conditionExpression') {
        ctx.checkAttributes(child, { consumed: [], defaults: {} });
        for (const sub of child.children) ctx.report(sub);
        const text = child.text.trim();
        if (text === '') ctx.invalidValue(child, 'conditionExpression', 'empty condition expression');
        else attributes.condition = text;
      } else ctx.report(child);
    }
    const edge: PendingEdge = {
      el,
      type: 'sequenceFlow',
      source: requireAttr(ctx, el, 'sourceRef'),
      target: requireAttr(ctx, el, 'targetRef'),
      parent,
      withId: true,
      attributes,
    };
    const name = attr(el, 'name');
    if (name !== undefined) edge.name = name;
    pending.push(edge);
  }

  function parseAssociation(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['sourceRef', 'targetRef'], defaults: { associationDirection: 'None' } });
    for (const child of childrenOf(el)) ctx.report(child);
    pending.push({
      el,
      type: 'association',
      source: requireAttr(ctx, el, 'sourceRef'),
      target: requireAttr(ctx, el, 'targetRef'),
      parent,
      withId: true,
      attributes: {},
    });
  }

  function parseDataAssociation(el: XmlElement, host: string, container: string): void {
    ctx.checkAttributes(el, { consumed: [], defaults: {} });
    const input = el.name === 'dataInputAssociation';
    const sources: string[] = [];
    let target: string | undefined;
    for (const child of childrenOf(el)) {
      if (isModel(child) && child.name === 'sourceRef') sources.push(child.text.trim());
      else if (isModel(child) && child.name === 'targetRef') target = child.text.trim();
      else ctx.report(child);
    }
    if (input) {
      // targetRef of an input association points into an ioSpecification, which is reported there.
      if (sources.length === 0) ctx.invalidValue(el, el.name, 'data input association without sourceRef');
      sources.forEach((s, i) =>
        pending.push({ el, type: 'dataInputAssociation', source: s, target: host, parent: container, withId: i === 0, attributes: {} }),
      );
    } else if (target === undefined || target === '') {
      ctx.invalidValue(el, el.name, 'data output association without targetRef');
    } else {
      pending.push({ el, type: 'dataOutputAssociation', source: host, target, parent: container, withId: true, attributes: {} });
    }
  }

  function parseDataObject(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['name'], defaults: { isCollection: 'false' } });
    ctx.addNode(el, 'dataObject', parent, {}, attr(el, 'name'));
    for (const child of childrenOf(el)) ctx.report(child);
  }

  function parseDataObjectReference(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['name', 'dataObjectRef'], defaults: {} });
    const node = ctx.addNode(el, 'dataObjectReference', parent, {}, attr(el, 'name'));
    const ref = attr(el, 'dataObjectRef');
    if (ref !== undefined && ref !== '') dataRefs.push({ node, el, ref });
    for (const child of childrenOf(el)) ctx.report(child);
  }

  function parseTextAnnotation(el: XmlElement, parent: string): void {
    ctx.checkAttributes(el, { consumed: [], defaults: { textFormat: 'text/plain' } });
    let text = '';
    for (const child of childrenOf(el)) {
      if (isModel(child) && child.name === 'text') text = child.text;
      else ctx.report(child);
    }
    ctx.addNode(el, 'textAnnotation', parent, { text });
  }

  function parseLaneSet(el: XmlElement, container: string, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['name'], defaults: {} });
    for (const child of childrenOf(el)) {
      if (isModel(child) && child.name === 'lane') parseLane(child, container, parent);
      else ctx.report(child);
    }
  }

  function parseLane(el: XmlElement, container: string, parent: string): void {
    ctx.checkAttributes(el, { consumed: ['name'], defaults: {} });
    const node = ctx.addNode(el, 'lane', parent, {}, attr(el, 'name'));
    const refs: { el: XmlElement; ref: string }[] = [];
    for (const child of childrenOf(el)) {
      if (isModel(child) && child.name === 'flowNodeRef') refs.push({ el: child, ref: child.text.trim() });
      else if (isModel(child) && child.name === 'childLaneSet') parseLaneSet(child, container, node.id);
      else ctx.report(child);
    }
    laneRefs.push({ node, el, refs });
  }

  function parseCollaboration(el: XmlElement): void {
    ctx.checkAttributes(el, { consumed: ['name'], defaults: { isClosed: 'false' } });
    const node = ctx.addNode(el, 'collaboration', undefined, {}, attr(el, 'name'));
    for (const child of childrenOf(el)) {
      if (!isModel(child)) ctx.report(child);
      else if (child.name === 'participant') {
        ctx.checkAttributes(child, { consumed: ['name', 'processRef'], defaults: {} });
        const p = ctx.addNode(child, 'participant', node.id, {}, attr(child, 'name'));
        const ref = attr(child, 'processRef');
        if (ref !== undefined && ref !== '') participantRefs.push({ node: p, el: child, ref });
        for (const sub of childrenOf(child)) ctx.report(sub);
      } else if (child.name === 'messageFlow') {
        ctx.checkAttributes(child, { consumed: ['name', 'sourceRef', 'targetRef'], defaults: {} });
        for (const sub of childrenOf(child)) ctx.report(sub);
        const edge: PendingEdge = {
          el: child,
          type: 'messageFlow',
          source: requireAttr(ctx, child, 'sourceRef'),
          target: requireAttr(ctx, child, 'targetRef'),
          parent: node.id,
          withId: true,
          attributes: {},
        };
        const name = attr(child, 'name');
        if (name !== undefined) edge.name = name;
        pending.push(edge);
      } else if (child.name === 'textAnnotation') parseTextAnnotation(child, node.id);
      else if (child.name === 'association') parseAssociation(child, node.id);
      else ctx.report(child);
    }
  }

  // ---- resolution ----------------------------------------------------

  const FLOW_NODE = new Set<string>([...TASK_TYPES, ...EVENT_TYPES, ...GATEWAY_TYPES, 'subProcess']);
  const nodeOf = (r: ModelNode | ModelEdge | undefined): ModelNode | undefined =>
    r && 'idExplicit' in r ? r : undefined;

  function resolveNode(ref: string, from: XmlElement, what: string): ModelNode | undefined {
    const hit = ctx.resolve(ref, from, what);
    if (hit === undefined) return undefined;
    const node = nodeOf(hit);
    if (!node) ctx.fail('invalid-reference', `${what} "${ref}" refers to a flow, not to a node`, from);
    return node;
  }

  function resolveEdges(): void {
    for (const p of pending) {
      const s = resolveNode(p.source, p.el, 'source');
      const t = resolveNode(p.target, p.el, 'target');
      if (!s || !t) continue;
      const bad = (msg: string): never => ctx.fail('invalid-reference', msg, p.el);
      if (p.type === 'sequenceFlow') {
        if (!FLOW_NODE.has(s.type) || !FLOW_NODE.has(t.type)) {
          bad(`sequenceFlow connects ${s.type} "${s.id}" and ${t.type} "${t.id}"; only flow nodes can be connected`);
        }
      } else if (p.type === 'messageFlow') {
        const ok = (n: ModelNode): boolean => FLOW_NODE.has(n.type) || n.type === 'participant';
        if (!ok(s) || !ok(t)) bad(`messageFlow connects ${s.type} "${s.id}" and ${t.type} "${t.id}"`);
      } else if (p.type === 'association') {
        const annotation = s.type === 'textAnnotation' || t.type === 'textAnnotation';
        if (!annotation) {
          ctx.notices.add(
            'unsupported-element',
            'association',
            '',
            NoticeBook.itemOf(p.el, { detail: `between ${s.type} and ${t.type}` }),
          );
          continue;
        }
      } else if (p.type === 'dataInputAssociation') {
        if (s.type !== 'dataObjectReference' && s.type !== 'dataObject') {
          bad(`data input association has the source ${s.type} "${s.id}"`);
        }
      } else if (t.type !== 'dataObjectReference' && t.type !== 'dataObject') {
        bad(`data output association has the target ${t.type} "${t.id}"`);
      }
      ctx.addEdge(p.el, p.type, s.id, t.id, p.parent, p.attributes, p.name, p.withId);
    }

    for (const d of defaults) {
      const target = ctx.resolve(d.ref, d.el, 'default');
      if (!target) continue;
      const flow = target as ModelEdge;
      if ('idExplicit' in target || flow.type !== 'sequenceFlow') {
        ctx.fail('invalid-reference', `default "${d.ref}" is not a sequence flow`, d.el);
      }
      if (flow.source !== d.node.id) {
        ctx.invalidValue(d.el, 'default', `default flow "${d.ref}" does not leave "${d.node.id}"`);
        continue;
      }
      flow.attributes.isDefault = true;
    }

    for (const r of participantRefs) {
      const target = resolveNode(r.ref, r.el, 'processRef');
      if (!target) continue;
      if (target.type !== 'process') ctx.fail('invalid-reference', `processRef "${r.ref}" is not a process`, r.el);
      r.node.attributes.processRef = target.id;
    }

    for (const r of dataRefs) {
      const target = resolveNode(r.ref, r.el, 'dataObjectRef');
      if (!target) continue;
      if (target.type !== 'dataObject') ctx.fail('invalid-reference', `dataObjectRef "${r.ref}" is not a data object`, r.el);
      r.node.attributes.dataObjectRef = target.id;
    }

    for (const l of laneRefs) {
      const members: string[] = [];
      for (const r of l.refs) {
        const target = resolveNode(r.ref, r.el, 'flowNodeRef');
        if (!target) continue;
        if (!FLOW_NODE.has(target.type) && target.type !== 'dataObjectReference' && target.type !== 'textAnnotation') {
          ctx.fail('invalid-reference', `flowNodeRef "${r.ref}" is a ${target.type}`, r.el);
        }
        members.push(target.id);
      }
      l.node.attributes.flowNodeRefs = members;
    }
  }

  // ---- diagram data --------------------------------------------------

  const isDi = (el: XmlElement, name: string): boolean => el.uri === BPMN_DI_NS && el.name === name;

  function bounds(el: XmlElement): string {
    const parts = ['x', 'y', 'width', 'height'].map((a) => fmtNum(parseNumber(ctx, el, a)));
    return parts.join(',');
  }

  function parseLabel(el: XmlElement, subject: string): void {
    ctx.checkAttributes(el, { consumed: [], defaults: {} });
    for (const child of childrenOf(el)) {
      if (child.uri === BPMN_DC_NS && child.name === 'Bounds') {
        ctx.layout.push({ subject, aspect: 'labelBounds', value: bounds(child), loc: child.loc });
      } else ctx.report(child);
    }
  }

  function parseDiagramElement(el: XmlElement, isShape: boolean): void {
    const spec = isShape
      ? { consumed: ['bpmnElement', 'isHorizontal', 'isExpanded', 'isMarkerVisible'], defaults: {} }
      : { consumed: ['bpmnElement'], defaults: {} };
    ctx.checkAttributes(el, spec);
    const ref = attr(el, 'bpmnElement');
    if (ref === undefined || ref === '') {
      ctx.invalidValue(el, el.name, 'no bpmnElement; the layout cannot be attached to a model element');
      return;
    }
    const target = ctx.resolve(ref, el, 'bpmnElement');
    if (!target) return;
    let subject: string;
    if (isShape) {
      const node = nodeOf(target);
      if (!node) return ctx.fail('invalid-reference', `BPMNShape "${ref}" refers to a flow`, el);
      subject = node.id;
    } else {
      if (nodeOf(target)) return ctx.fail('invalid-reference', `BPMNEdge "${ref}" refers to a node`, el);
      subject = (target as ModelEdge).key;
    }
    const waypoints: string[] = [];
    for (const child of childrenOf(el)) {
      if (isShape && child.uri === BPMN_DC_NS && child.name === 'Bounds') {
        ctx.layout.push({ subject, aspect: 'bounds', value: bounds(child), loc: child.loc });
      } else if (!isShape && child.uri === BPMN_DD_NS && child.name === 'waypoint') {
        waypoints.push(`${fmtNum(parseNumber(ctx, child, 'x'))},${fmtNum(parseNumber(ctx, child, 'y'))}`);
      } else if (isDi(child, 'BPMNLabel')) parseLabel(child, subject);
      else ctx.report(child);
    }
    if (waypoints.length > 0) ctx.layout.push({ subject, aspect: 'waypoints', value: waypoints.join(';'), loc: el.loc });
    if (isShape) {
      for (const flag of ['isHorizontal', 'isExpanded', 'isMarkerVisible']) {
        const v = parseBool(ctx, el, flag);
        if (v !== undefined) ctx.layout.push({ subject, aspect: flag, value: String(v), loc: el.loc });
      }
    }
  }

  function parseDiagram(el: XmlElement): void {
    ctx.layoutRanges.push(el.loc);
    ctx.checkAttributes(el, { consumed: [], defaults: {} });
    for (const child of childrenOf(el)) {
      if (!isDi(child, 'BPMNPlane')) {
        ctx.report(child);
        continue;
      }
      ctx.checkAttributes(child, { consumed: ['bpmnElement'], defaults: {} });
      for (const item of childrenOf(child)) {
        if (isDi(item, 'BPMNShape')) parseDiagramElement(item, true);
        else if (isDi(item, 'BPMNEdge')) parseDiagramElement(item, false);
        else ctx.report(item);
      }
    }
  }

  // ---- entry ---------------------------------------------------------

  for (const child of childrenOf(root)) {
    if (!isModel(child)) {
      if (isDi(child, 'BPMNDiagram')) diagrams.push(child);
      else ctx.report(child);
    } else if (child.name === 'process') parseProcess(child);
    else if (child.name === 'collaboration') parseCollaboration(child);
    else ctx.report(child);
  }
  resolveEdges();
  diagrams.forEach(parseDiagram);

  const base = { formalism: 'bpmn' as const, nodes: ctx.nodes, edges: ctx.edges, layout: ctx.layout };
  return {
    schemaVersion: SCHEMA_VERSION,
    ...base,
    layoutRanges: ctx.layoutRanges,
    facts: deriveFacts(base),
    notices: ctx.notices.list(),
  };
}

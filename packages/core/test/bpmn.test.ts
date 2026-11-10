import { describe, expect, it } from 'vitest';
import { parseModel, ParseError } from '../src/index.js';
import { allFacts, bpmn, factsOf } from './helpers.js';

const m = (body: string) => parseModel(bpmn(body));

describe('BPMN: tasks, events, gateways', () => {
  it('reads all task types with label, node and node type facts', () => {
    const types = ['task', 'userTask', 'serviceTask', 'scriptTask', 'sendTask', 'receiveTask', 'manualTask', 'businessRuleTask'];
    const body = `<process id="p">${types.map((t) => `<${t} id="${t}1" name="N ${t}"/>`).join('')}</process>`;
    const model = m(body);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'nodeType')).toEqual(types.map((t) => `nodeType|${t}1||${t}`));
    expect(factsOf(model, 'node')).toEqual(types.flatMap((t) => [`node|${t}1||`, `node|${t}1|parent|p`]));
    expect(factsOf(model, 'label')).toContain('label|userTask1||N userTask');
    expect(factsOf(model, 'identifier')).toContain('identifier|manualTask1||manualTask1');
  });

  it('reads event types with their event definitions', () => {
    const defs = ['message', 'timer', 'error', 'signal', 'escalation', 'conditional', 'link', 'compensate', 'cancel', 'terminate'];
    const body = `<process id="p">
      <startEvent id="s"/>
      <startEvent id="sm"><messageEventDefinition/></startEvent>
      <intermediateCatchEvent id="ic"><timerEventDefinition/></intermediateCatchEvent>
      <intermediateThrowEvent id="it"><signalEventDefinition/></intermediateThrowEvent>
      <endEvent id="e"><terminateEventDefinition/></endEvent>
      <endEvent id="multi"><errorEventDefinition/><escalationEventDefinition/></endEvent>
      <intermediateCatchEvent id="c1"><conditionalEventDefinition/></intermediateCatchEvent>
      <intermediateThrowEvent id="c2"><linkEventDefinition/></intermediateThrowEvent>
      <intermediateThrowEvent id="c3"><compensateEventDefinition/></intermediateThrowEvent>
      <endEvent id="c4"><cancelEventDefinition/></endEvent>
    </process>`;
    const model = m(body);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'nodeType')).toContain('nodeType|s||startEvent');
    expect(factsOf(model, 'nodeType')).toContain('nodeType|it||intermediateThrowEvent');
    expect(factsOf(model, 'eventType')).toEqual([
      'eventType|sm||message',
      'eventType|ic||timer',
      'eventType|it||signal',
      'eventType|e||terminate',
      'eventType|multi||error',
      'eventType|multi||escalation',
      'eventType|c1||conditional',
      'eventType|c2||link',
      'eventType|c3||compensate',
      'eventType|c4||cancel',
    ]);
    expect(defs).toHaveLength(10);
  });

  it('reads the four gateway types', () => {
    const model = m(`<process id="p">
      <exclusiveGateway id="x"/><parallelGateway id="a"/><inclusiveGateway id="o"/><eventBasedGateway id="v"/>
    </process>`);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'nodeType')).toEqual([
      'nodeType|x||exclusiveGateway',
      'nodeType|a||parallelGateway',
      'nodeType|o||inclusiveGateway',
      'nodeType|v||eventBasedGateway',
    ]);
  });

  it('reports event definition details that are not modelled', () => {
    const model = m(`<process id="p"><intermediateCatchEvent id="t">
      <timerEventDefinition><timeDuration>PT1H</timeDuration></timerEventDefinition></intermediateCatchEvent></process>`);
    expect(factsOf(model, 'eventType')).toEqual(['eventType|t||timer']);
    expect(model.notices).toMatchObject([{ kind: 'unsupported-element', type: 'timeDuration', count: 1 }]);
  });
});

describe('BPMN: flows', () => {
  const flows = `<process id="p">
    <startEvent id="s"/><exclusiveGateway id="g" default="f2"/><task id="a"/><task id="b"/>
    <sequenceFlow id="f1" sourceRef="s" targetRef="g"/>
    <sequenceFlow id="f2" name="else" sourceRef="g" targetRef="a"/>
    <sequenceFlow id="f3" name="yes" sourceRef="g" targetRef="b">
      <conditionExpression xsi:type="tFormalExpression"> x &gt; 1 </conditionExpression>
    </sequenceFlow>
  </process>`;

  it('reads sequence flows with names, conditions and the default flow', () => {
    const model = m(flows);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'sequenceFlow')).toEqual(['sequenceFlow|["s","g"]||', 'sequenceFlow|["g","a"]||', 'sequenceFlow|["g","b"]||']);
    expect(factsOf(model, 'sequenceFlowName')).toEqual(['sequenceFlowName|["g","a"]||else', 'sequenceFlowName|["g","b"]||yes']);
    expect(factsOf(model, 'condition')).toEqual(['condition|["g","b"]||x > 1']);
    expect(factsOf(model, 'defaultFlow')).toEqual(['defaultFlow|["g","a"]||']);
    expect(factsOf(model, 'identifier')).toContain('identifier|["g","a"]||f2');
  });

  it('identifies repeated endpoint pairs by occurrence', () => {
    const model = m(`<process id="p"><task id="a"/><task id="b"/>
      <sequenceFlow id="x1" sourceRef="a" targetRef="b"/><sequenceFlow id="x2" sourceRef="a" targetRef="b"/></process>`);
    expect(factsOf(model, 'sequenceFlow')).toEqual(['sequenceFlow|["a","b"]||', 'sequenceFlow|["a","b",2]||']);
  });

  it('rejects a default flow that does not leave the element', () => {
    const model = m(`<process id="p"><task id="a" default="f"/><task id="b"/>
      <sequenceFlow id="f" sourceRef="b" targetRef="a"/></process>`);
    expect(factsOf(model, 'defaultFlow')).toEqual([]);
    expect(model.notices).toMatchObject([{ kind: 'invalid-value', type: 'default' }]);
  });

  it('fails on a flow to an id that does not exist', () => {
    expect(() => m(`<process id="p"><task id="a"/><sequenceFlow id="f" sourceRef="a" targetRef="zzz"/></process>`)).toThrow(
      /zzz/,
    );
    try {
      m(`<process id="p"><task id="a"/><sequenceFlow id="f" sourceRef="a" targetRef="zzz"/></process>`);
    } catch (e) {
      expect((e as ParseError).code).toBe('unresolved-reference');
    }
  });

  it('fails on a sequence flow that ends at a lane', () => {
    const body = `<process id="p"><task id="a"/><laneSet><lane id="l"/></laneSet>
      <sequenceFlow id="f" sourceRef="a" targetRef="l"/></process>`;
    expect(() => m(body)).toThrow(ParseError);
  });
});

describe('BPMN: pools, lanes, message flows', () => {
  const body = `
    <collaboration id="c">
      <participant id="pa" name="Customer" processRef="p1"/>
      <participant id="pb" name="Shop"/>
      <messageFlow id="m1" name="order" sourceRef="t1" targetRef="pb"/>
    </collaboration>
    <process id="p1">
      <laneSet id="ls"><lane id="l1" name="Front"><flowNodeRef>t1</flowNodeRef>
        <childLaneSet><lane id="l2" name="Inner"><flowNodeRef>t2</flowNodeRef></lane></childLaneSet></lane></laneSet>
      <task id="t1"/><task id="t2"/>
    </process>`;

  it('reads participants, lanes, nesting and message flows', () => {
    const model = m(body);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'poolLane')).toEqual([
      'poolLane|c|kind|collaboration',
      'poolLane|pa|kind|participant',
      'poolLane|pa|parent|c',
      'poolLane|pa|process|p1',
      'poolLane|pb|kind|participant',
      'poolLane|pb|parent|c',
      'poolLane|p1|kind|process',
      'poolLane|l1|kind|lane',
      'poolLane|l1|parent|p1',
      'poolLane|l1|member|t1',
      'poolLane|l2|kind|lane',
      'poolLane|l2|parent|l1',
      'poolLane|l2|member|t2',
    ]);
    expect(factsOf(model, 'messageFlow')).toEqual(['messageFlow|["t1","pb"]||']);
    expect(factsOf(model, 'label')).toEqual(
      expect.arrayContaining(['label|pa||Customer', 'label|l2||Inner', 'label|["t1","pb"]||order']),
    );
  });

  it('supports several processes in one file', () => {
    const model = m(`<process id="a"><task id="x"/></process><process id="b"><task id="y"/></process>`);
    expect(factsOf(model, 'node').filter((f) => f.includes('parent'))).toEqual(['node|x|parent|a', 'node|y|parent|b']);
  });
});

describe('BPMN: data objects, annotations, sub-processes', () => {
  it('reads data objects, references and data associations', () => {
    const model = m(`<process id="p">
      <dataObject id="d"/><dataObjectReference id="dr" name="Invoice" dataObjectRef="d"/>
      <task id="a">
        <dataInputAssociation id="in1"><sourceRef>dr</sourceRef></dataInputAssociation>
        <dataOutputAssociation id="out1"><targetRef>dr</targetRef></dataOutputAssociation>
      </task></process>`);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'dataObject')).toEqual([
      'dataObject|d|kind|dataObject',
      'dataObject|d|parent|p',
      'dataObject|dr|kind|dataObjectReference',
      'dataObject|dr|parent|p',
      'dataObject|dr|ref|d',
      'dataObject|["dr","a"]|association|input',
      'dataObject|["a","dr"]|association|output',
    ]);
    expect(factsOf(model, 'label')).toContain('label|dr||Invoice');
  });

  it('reads text annotations and their associations', () => {
    const model = m(`<process id="p"><task id="a"/>
      <textAnnotation id="n"><text>Check &amp; sign</text></textAnnotation>
      <association id="as" sourceRef="a" targetRef="n"/></process>`);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'annotation')).toEqual([
      'annotation|n|kind|textAnnotation',
      'annotation|n|parent|p',
      'annotation|n|text|Check & sign',
      'annotation|["a","n"]|association|',
    ]);
  });

  it('reads embedded sub-processes with their content', () => {
    const model = m(`<process id="p"><subProcess id="sp" name="Sub"><startEvent id="i"/><task id="j"/>
      <sequenceFlow id="sf" sourceRef="i" targetRef="j"/></subProcess></process>`);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'nodeType')).toContain('nodeType|sp||subProcess');
    expect(factsOf(model, 'node')).toEqual(expect.arrayContaining(['node|sp|parent|p', 'node|i|parent|sp', 'node|j|parent|sp']));
    expect(factsOf(model, 'sequenceFlow')).toEqual(['sequenceFlow|["i","j"]||']);
  });
});

describe('BPMN: layout (diagram data)', () => {
  it('reads shapes, labels, edges and waypoints as layout facts', () => {
    const model = m(`<process id="p"><startEvent id="s" name="Go"/><task id="a"/>
      <sequenceFlow id="f" sourceRef="s" targetRef="a"/></process>
      <collaboration id="c"><participant id="pa" processRef="p"/></collaboration>
      <bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane id="pl" bpmnElement="c">
        <bpmndi:BPMNShape id="s_di" bpmnElement="s"><dc:Bounds x="10" y="20.5" width="36" height="36"/>
          <bpmndi:BPMNLabel><dc:Bounds x="1" y="2" width="3" height="4"/></bpmndi:BPMNLabel></bpmndi:BPMNShape>
        <bpmndi:BPMNShape id="pa_di" bpmnElement="pa" isHorizontal="true"><dc:Bounds x="0" y="0" width="300" height="200"/></bpmndi:BPMNShape>
        <bpmndi:BPMNEdge id="f_di" bpmnElement="f"><di:waypoint x="46" y="38"/><di:waypoint x="100" y="38.0"/></bpmndi:BPMNEdge>
      </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
    expect(model.notices).toEqual([]);
    expect(factsOf(model, 'layout')).toEqual([
      'layout|s|bounds|10,20.5,36,36',
      'layout|s|labelBounds|1,2,3,4',
      'layout|pa|bounds|0,0,300,200',
      'layout|pa|isHorizontal|true',
      'layout|["s","a"]|waypoints|46,38;100,38',
    ]);
    expect(model.layoutRanges).toHaveLength(1);
  });

  it('fails when a shape refers to an id that does not exist', () => {
    expect(() =>
      m(`<process id="p"/><bpmndi:BPMNDiagram><bpmndi:BPMNPlane><bpmndi:BPMNShape bpmnElement="nope">
        <dc:Bounds x="0" y="0" width="1" height="1"/></bpmndi:BPMNShape></bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`),
    ).toThrow(/nope/);
  });
});

describe('BPMN: identity and elements without id', () => {
  it('synthesizes ids deterministically and gives them no identifier fact', () => {
    const body = `<process id="p"><task name="A"/><task name="B"/><startEvent/></process>`;
    const model = m(body);
    expect(model.nodes.map((n) => [n.id, n.idExplicit])).toEqual([
      ['p', true],
      ['anon_task_1', false],
      ['anon_task_2', false],
      ['anon_startEvent_1', false],
    ]);
    expect(factsOf(model, 'identifier')).toEqual(['identifier|p||p']);
    expect(m(body).facts).toEqual(model.facts);
  });

  it('avoids collisions with explicit ids', () => {
    const model = m(`<process id="p"><task id="anon_task_1"/><task/></process>`);
    expect(model.nodes.map((n) => n.id)).toEqual(['p', 'anon_task_1', 'anon_task_2']);
  });

  it('identifies flows without id by their endpoints', () => {
    const model = m(`<process id="p"><task id="a"/><task id="b"/><sequenceFlow sourceRef="a" targetRef="b"/></process>`);
    expect(factsOf(model, 'sequenceFlow')).toEqual(['sequenceFlow|["a","b"]||']);
    expect(factsOf(model, 'identifier')).toEqual(['identifier|p||p', 'identifier|a||a', 'identifier|b||b']);
  });

  it('fails on duplicate ids', () => {
    expect(() => m(`<process id="p"><task id="a"/><task id="a"/></process>`)).toThrow(/duplicate id "a"/);
  });

  it('gives each fact a content-derived, unique id and one category', () => {
    const model = m(`<process id="p"><task id="a" name="A"/><task id="b"/><sequenceFlow sourceRef="a" targetRef="b"/></process>`);
    expect(new Set(model.facts.map((f) => f.id)).size).toBe(model.facts.length);
    expect(allFacts(model)).toContain('label|a||A');
    const f = model.facts.find((x) => x.category === 'label');
    expect(f?.id).toBe(JSON.stringify(['label', 'a', '', 'A']));
  });
});

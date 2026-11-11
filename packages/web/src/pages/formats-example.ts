/**
 * The two small models the Formats page shows the representations of (FA-81). They are built into the page; the examples of the core
 * generate the texts live, so the page can never show an output that the generators do not make.
 */
export const BPMN_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Defs">
  <bpmn:process id="P" name="Order">
    <bpmn:startEvent id="S" name="Order received"/>
    <bpmn:userTask id="T" name="Check order"/>
    <bpmn:exclusiveGateway id="G" name="Valid?" default="F3"/>
    <bpmn:endEvent id="E1" name="Done"/>
    <bpmn:endEvent id="E2" name="Rejected"/>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/>
    <bpmn:sequenceFlow id="F2" name="yes" sourceRef="T" targetRef="G"/>
    <bpmn:sequenceFlow id="F3" name="no" sourceRef="G" targetRef="E2"/>
    <bpmn:sequenceFlow id="F4" name="yes" sourceRef="G" targetRef="E1"/>
  </bpmn:process>
</bpmn:definitions>
`;

export const PNML_EXAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<pnml>
  <net id="N" type="http://www.pnml.org/version-2009/grammar/ptnet">
    <name><text>Request</text></name>
    <page id="pg">
      <place id="p1"><name><text>waiting</text></name><initialMarking><text>1</text></initialMarking></place>
      <place id="p2"><name><text>done</text></name></place>
      <transition id="t1"><name><text>handle</text></name></transition>
      <arc id="a1" source="p1" target="t1"/>
      <arc id="a2" source="t1" target="p2"><inscription><text>2</text></inscription></arc>
    </page>
  </net>
</pnml>
`;

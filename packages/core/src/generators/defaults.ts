import { compactGenerator } from './compact.js';
import { jsonGenerator } from './json.js';
import { mermaidGenerator } from './mermaid.js';
import { originalGenerator, originalNoLayoutGenerator } from './original.js';
import { GeneratorRegistry } from './registry.js';
import { verbalizationGenerator } from './verbalize.js';

/** Register with every generator of milestone 1, in the order a user interface lists them. */
export function createDefaultRegistry(): GeneratorRegistry {
  return new GeneratorRegistry()
    .register(originalGenerator)
    .register(originalNoLayoutGenerator)
    .register(jsonGenerator)
    .register(mermaidGenerator)
    .register(compactGenerator)
    .register(verbalizationGenerator);
}

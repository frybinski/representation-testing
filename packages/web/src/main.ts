import { createBundle, createDefaultRegistry, loadDefaultTokenizer, serializeBundle } from '@repr-werkbank/core';
import exampleText from '../../../examples/bpmn/order-handling.bpmn?raw';
import { mountApp } from './app.ts';
import './styles.css';
import { tokensCss } from './tokens.ts';

// The example of the draft: examples/bpmn/order-handling.bpmn (has layout; its inventory shows real differences between representations).
const EXAMPLE_NAME = 'order-handling.bpmn';

const style = document.createElement('style');
style.textContent = tokensCss();
document.head.prepend(style);

declare global {
  interface Window {
    /** Read by scripts/screenshots.ts to compare the bundle made in the browser with the golden file. */
    __reprWerkbank?: { bundleJson: string };
  }
}

const root = document.getElementById('app');
if (!root) throw new Error('#app is missing');
root.textContent = 'Loading model…';

try {
  const tokenizer = await loadDefaultTokenizer();
  const registry = createDefaultRegistry();
  const bundle = createBundle(exampleText, { tokenizer, registry, inputName: EXAMPLE_NAME });
  window.__reprWerkbank = { bundleJson: serializeBundle(bundle) };
  mountApp({ root, bundle, registry, modelName: EXAMPLE_NAME, initialViews: ['original', 'verbalization'] });
} catch (e) {
  root.textContent = `The model could not be processed: ${e instanceof Error ? e.message : String(e)}`;
  throw e;
}

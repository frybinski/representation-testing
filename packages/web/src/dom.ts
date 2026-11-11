type Child = Node | string;

/** Creates an element. Text goes in as text nodes, never as markup, so model-derived strings cannot inject HTML. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | boolean> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false) continue;
    node.setAttribute(k, v === true ? '' : v);
  }
  node.append(...children);
  return node;
}

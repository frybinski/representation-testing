/**
 * The only place that names addresses outside the page (R-2). They are link targets the person may follow; the page never requests them.
 * `externalLink` is the only way they reach the DOM, as an `href`; `tests/no-external-references.test.ts` allows exactly these addresses
 * in the web build and nowhere else, and checks that the sources use them only through `externalLink`.
 */
export const LINKS = {
  doi: 'https://doi.org/10.1007/978-3-032-40377-3_3',
  repository: 'https://github.com/frybinski/representation-testing',
  licenseMit: 'https://github.com/frybinski/representation-testing/blob/main/LICENSE',
  citation: 'https://github.com/frybinski/representation-testing/blob/main/CITATION.cff',
  licenseCcBy: 'https://creativecommons.org/licenses/by/4.0/',
} as const;

export type LinkName = keyof typeof LINKS;

/** A link that opens in a new tab, so that the tool and the loaded model stay where they are (models are never stored). */
export function externalLink(name: LinkName, text: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = LINKS[name];
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = text;
  return a;
}

/** A link to a file of the build (relative to the page, same origin). */
export function fileLink(path: string, text: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.href = path;
  a.target = '_blank';
  a.textContent = text;
  return a;
}

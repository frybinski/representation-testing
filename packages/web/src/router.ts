/**
 * Hash routing (plan 4.3): `#/` is the workspace, `#/about`, `#/formats` and `#/legal` are pages. A hash needs no server rule, so the
 * build works on GitHub Pages below a sub path. Everything else is the workspace.
 */
export type Route = 'workspace' | 'about' | 'formats' | 'legal';

const ROUTES: Record<string, Route> = { '#/about': 'about', '#/formats': 'formats', '#/legal': 'legal' };

export function parseRoute(hash: string): Route {
  return ROUTES[hash.replace(/\/+$/, '')] ?? 'workspace';
}

export function hrefOf(route: Route): string {
  return route === 'workspace' ? '#/' : `#/${route}`;
}

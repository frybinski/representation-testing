const NS = 'http://www.w3.org/2000/svg';

export type IconName = 'options' | 'copy' | 'save' | 'scheme' | 'complete' | 'partial' | 'none' | 'chevron' | 'check' | 'info' | 'close' | 'warning' | 'up' | 'down' | 'sort';

// 16 x 16 grid, drawn with currentColor so that the icon follows the text colour of the scheme.
const PATHS: Record<IconName, string> = {
  options: '<path d="M2 4.5h7M12 4.5h2M2 11.5h2M7 11.5h7" /><circle cx="10.5" cy="4.5" r="1.5" /><circle cx="5.5" cy="11.5" r="1.5" />',
  copy: '<rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />',
  save: '<path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13.5h10" />',
  scheme: '<circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />',
  complete: '<circle cx="8" cy="8" r="5.5" fill="currentColor" />',
  partial: '<circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />',
  none: '<circle cx="8" cy="8" r="5.5" />',
  chevron: '<path d="M4 6.5 8 10.5 12 6.5" />',
  check: '<path d="M3.5 8.5 6.5 11.5 12.5 4.5" />',
  info: '<circle cx="8" cy="8" r="5.5" /><path d="M8 7.25v3.5" /><circle cx="8" cy="5.25" r="0.25" />',
  close: '<path d="M4 4l8 8M12 4l-8 8" />',
  up: '<path d="M8 13V3.5M4.5 7 8 3.5 11.5 7" />',
  down: '<path d="M8 3v9.5M4.5 9 8 12.5 11.5 9" />',
  sort: '<path d="M5.5 3.5v9M3 10l2.5 2.5L8 10M10.5 12.5v-9M8 6l2.5-2.5L13 6" />',
  warning: '<path d="M8 2.5 14 13H2z" /><path d="M8 6.5v3" /><circle cx="8" cy="11.25" r="0.25" />',
};

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = PATHS[name];
  return svg;
}

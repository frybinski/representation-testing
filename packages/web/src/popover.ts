/**
 * Small non-modal panels (UI-04, UI-08: no dialogs for routine actions). A panel opens next to its button, closes with Escape, with a
 * click outside or with its button again, and gives the focus back to the button. At most one is open at a time.
 */

export interface Popover {
  readonly button: HTMLElement;
  readonly panel: HTMLElement;
  readonly isOpen: boolean;
  /** A disabled popover ignores its button (the button then does something else) and carries no popup attributes. */
  setEnabled(enabled: boolean): void;
  open(): void;
  close(returnFocus?: boolean): void;
}

let openPopover: Popover | null = null;

export function attachPopover(button: HTMLElement, panel: HTMLElement, onOpen?: () => void): Popover {
  panel.hidden = true;
  let enabled = true;
  const syncAttributes = (): void => {
    if (enabled) {
      button.setAttribute('aria-expanded', String(!panel.hidden));
      if (panel.id) button.setAttribute('aria-controls', panel.id);
      button.setAttribute('aria-haspopup', 'true');
    } else {
      button.removeAttribute('aria-expanded');
      button.removeAttribute('aria-controls');
      button.removeAttribute('aria-haspopup');
    }
  };
  syncAttributes();

  const popover: Popover = {
    button,
    panel,
    get isOpen() {
      return !panel.hidden;
    },
    setEnabled(value) {
      enabled = value;
      if (!value) popover.close();
      syncAttributes();
    },
    open() {
      if (!enabled) return;
      if (openPopover && openPopover !== popover) openPopover.close();
      onOpen?.();
      panel.hidden = false;
      syncAttributes();
      openPopover = popover;
    },
    close(returnFocus = false) {
      if (panel.hidden) return;
      panel.hidden = true;
      syncAttributes();
      if (openPopover === popover) openPopover = null;
      if (returnFocus) button.focus();
    },
  };

  button.addEventListener('click', () => {
    if (!enabled) return;
    if (popover.isOpen) popover.close();
    else popover.open();
  });
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      popover.close(true);
    }
  });
  return popover;
}

// One listener for all panels: a click outside the open panel and its button closes it; Escape closes it from anywhere on the page.
document.addEventListener('pointerdown', (e) => {
  const open = openPopover;
  if (!open) return;
  const target = e.target;
  if (target instanceof Node && (open.panel.contains(target) || open.button.contains(target))) return;
  open.close();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openPopover) openPopover.close(true);
});

/** Closes the open panel, if any (a new model was loaded, for example). */
export function closeOpenPopover(): void {
  openPopover?.close();
}

/** Whether a panel is open, so that Escape can be left to it. */
export function hasOpenPopover(): boolean {
  return openPopover !== null;
}

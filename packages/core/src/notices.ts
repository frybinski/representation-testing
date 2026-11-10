import type { Notice, NoticeItem, NoticeKind } from './model.js';
import type { XmlElement } from './xml.js';
import { attr } from './xml.js';

/** Collects notices (FA-04), grouped by kind, namespace and type in order of first occurrence. */
export class NoticeBook {
  private readonly groups = new Map<string, Notice>();

  add(kind: NoticeKind, type: string, namespace: string, item: NoticeItem): void {
    const key = JSON.stringify([kind, namespace, type]);
    let group = this.groups.get(key);
    if (!group) {
      group = { kind, type, count: 0, items: [] };
      if (namespace !== '') group.namespace = namespace;
      this.groups.set(key, group);
    }
    group.items.push(item);
    group.count = group.items.length;
  }

  /** Item for an element: its id (if any) and line. */
  static itemOf(el: XmlElement, extra: Partial<NoticeItem> = {}): NoticeItem {
    const id = extra.id ?? attr(el, 'id');
    const item: NoticeItem = {
      ...(id !== undefined && { id }),
      line: el.loc.line,
      ...(extra.host !== undefined && { host: extra.host }),
      ...(extra.detail !== undefined && { detail: extra.detail }),
    };
    return item;
  }

  list(): Notice[] {
    return [...this.groups.values()];
  }
}

// The panels are written as HTML strings and redrawn four times a second. Set as innerHTML,
// every button and row was a new element each time: a button you'd aimed at could be gone
// by the time you pressed it (2026-10-28, map 2418 at 4x: the routes list's buttons were
// replaced in 78 of 79 redraws, and a scripted click failed with "not attached to the DOM").
// patchHtml applies the new HTML to the elements already there instead: text and attributes
// change in place, and an element is added or removed only when the content is. The page
// still re-derives everything from the world each time (render-and-ui.md): this keeps the
// elements, not the state.

const lastHtml = new WeakMap<Element, string>();
const template = document.createElement("template");

/** Sets `el`'s contents to `html`, keeping the elements that are still there. */
export function patchHtml(el: Element, html: string): void {
  if (lastHtml.get(el) === html) return;
  lastHtml.set(el, html);
  template.innerHTML = html;
  patchChildren(el, template.content);
}

// Rows and folds carry their own identity: matched by it, a row that moves is the same row.
function keyOf(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  for (const name of ["data-pick", "data-fold", "data-tab", "data-key", "id"]) {
    const value = node.getAttribute(name);
    if (value !== null) return `${node.tagName}:${name}=${value}`;
  }
  return null;
}

function same(a: Node, b: Node): boolean {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && keyOf(a) === keyOf(b);
}

function patchChildren(parent: Node, next: Node): void {
  const keyed = new Map<string, Node>();
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    const key = keyOf(child);
    if (key !== null) keyed.set(key, child);
  }
  let cursor = parent.firstChild;
  for (const wanted of [...next.childNodes]) {
    const key = keyOf(wanted);
    let match: Node | null = null;
    if (key !== null) match = keyed.get(key) ?? null;
    else if (cursor && same(cursor, wanted)) match = cursor;
    if (match) {
      keyed.delete(key ?? "");
      if (match !== cursor) parent.insertBefore(match, cursor);
      else cursor = cursor.nextSibling;
      patchNode(match, wanted);
    } else parent.insertBefore(wanted, cursor);
  }
  // Whatever wasn't wanted again goes.
  while (cursor) {
    const after: ChildNode | null = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = after;
  }
}

function patchNode(node: Node, wanted: Node): void {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    if (node.nodeValue !== wanted.nodeValue) node.nodeValue = wanted.nodeValue;
    return;
  }
  const el = node as Element;
  const to = wanted as Element;
  for (const { name } of [...el.attributes]) if (!to.hasAttribute(name)) el.removeAttribute(name);
  for (const { name, value } of [...to.attributes]) if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  // A field's value is a property once it's been typed in: keep it in step unless it's being typed in now.
  if (el instanceof HTMLInputElement && el !== document.activeElement) {
    const input = to as HTMLInputElement;
    if (el.value !== input.value) el.value = input.value;
    if (el.checked !== input.checked) el.checked = input.checked;
  }
  patchChildren(el, to);
}

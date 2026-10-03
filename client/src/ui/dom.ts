// Tiny DOM helpers (no framework).

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls = '', text?: string, parent?: HTMLElement,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** Set textContent only when it changed, so per frame HUD updates do not touch the DOM needlessly. */
export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setClass(node: HTMLElement, cls: string, on: boolean): void {
  if (node.classList.contains(cls) !== on) node.classList.toggle(cls, on);
}

export function btn(label: string, cls: string, onClick: () => void, parent?: HTMLElement): HTMLButtonElement {
  const b = el('button', cls, label, parent);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

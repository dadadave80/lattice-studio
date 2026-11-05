const invokers = new WeakMap<Element, HTMLElement>();

export function rememberMenuInvoker(menu: HTMLElement | null, invoker: HTMLElement | null): void {
  if (menu && invoker) invokers.set(menu, invoker);
}

/** A submenu's trigger can disappear too: follow its parent menu to the persistent outer opener. */
export function menuReturnTarget(active: Element | null): Element | null {
  let target = active;
  let menu = target?.closest('[role="menu"]');
  while (menu) {
    const invoker = invokers.get(menu);
    if (!invoker) break;
    target = invoker;
    menu = target.closest('[role="menu"]');
  }
  return target;
}

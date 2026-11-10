type Child = Node | string | null | false | undefined;

/** Tiny hyperscript helper. Text is always inserted as text nodes, never HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<{
    class: string;
    text: string;
    onclick: (e: Event) => void;
    disabled: boolean;
    attrs: Record<string, string>;
    style: Partial<CSSStyleDeclaration>;
  }> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.onclick) el.addEventListener("click", props.onclick);
  if (props.disabled !== undefined && "disabled" in el)
    (el as HTMLButtonElement).disabled = props.disabled;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.style) Object.assign(el.style, props.style);
  for (const c of children) if (c) el.append(c);
  return el;
}

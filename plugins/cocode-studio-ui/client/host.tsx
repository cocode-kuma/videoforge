import { activate } from "./main.js";
export const name = "cocode-studio-ui";
export function apply(ctx: { effect: (fn: () => () => void) => void }) {
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = "/app.css";
  document.head.append(css);
  const el = document.createElement("div");
  el.id = "cocode-studio-root";
  document.body.replaceChildren(el);
  const dispose = activate(el);
  ctx.effect(() => () => {
    dispose();
    css.remove();
  });
}

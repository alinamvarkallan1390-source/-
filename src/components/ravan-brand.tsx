import { createElement } from "react";

export function BrandMark() {
  return createElement("span", { className: "brand-mark", "aria-hidden": true },
    createElement("svg", { viewBox: "0 0 44 44", fill: "none" },
      createElement("path", { d: "M9 29.5c0-8.1 5.8-14.5 13.4-14.5 4.6 0 8.2 1.8 11.2 5.3", stroke: "currentColor", strokeWidth: "4.1", strokeLinecap: "round" }),
      createElement("path", { d: "M34.2 11v14.1c0 4.6-3.5 8.2-8.1 8.2-3.1 0-5.8-1.6-7.2-4.1", stroke: "var(--accent-lilac)", strokeWidth: "4.1", strokeLinecap: "round" }),
      createElement("circle", { cx: "10", cy: "33", r: "2.6", fill: "currentColor" }),
    ),
  );
}

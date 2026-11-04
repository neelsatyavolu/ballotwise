import { describe, expect, it } from "vitest";
import { layout } from "../components/midterms/useRotatingFit";

/** Stand-in cards, each 10 tall, stacked in their CSS order: a box with bottom 30 fits three. */
function cards(n: number) {
  const items = Array.from({ length: n }, (_, id) => {
    const el = { id, hidden: false, style: { order: "0" }, getBoundingClientRect: () => ({ bottom: (Number(el.style.order) + 1) * 10 }) };
    return el;
  });
  const up = () => items.filter((x) => !x.hidden).sort((a, b) => Number(a.style.order) - Number(b.style.order)).map((x) => x.id);
  return { items: items as unknown as HTMLElement[], up };
}

describe("rotating fit with fixed cards", () => {
  it("keeps the fixed cards up and rotates the rest through the space left", () => {
    const { items, up } = cards(6);
    expect(layout(items, 2, 0, () => 30)).toEqual({ from: 0, count: 1, total: 4 });
    expect(up()).toEqual([0, 1, 2]);
    layout(items, 2, 1, () => 30);
    expect(up()).toEqual([0, 1, 3]);
    layout(items, 2, 3, () => 30);
    expect(up()).toEqual([0, 1, 5]);
  });

  it("rotates only among the fixed cards when they don't all fit, never bringing in the rest", () => {
    const { items, up } = cards(6);
    expect(layout(items, 4, 0, () => 30)).toEqual({ from: 0, count: 3, total: 4 });
    expect(up()).toEqual([0, 1, 2]);
    layout(items, 4, 3, () => 30);
    expect(up()).toEqual([3, 0, 1]);
  });

  it("rotates the whole list with nothing fixed", () => {
    const { items, up } = cards(5);
    layout(items, 0, 3, () => 30);
    expect(up()).toEqual([3, 4, 0]);
  });
});

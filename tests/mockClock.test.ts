import { afterEach, describe, expect, it, vi } from "vitest";

/** A browser with its own localStorage, so the clock module sees `window`. */
function browser() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("window", { addEventListener: vi.fn(), location: { href: "https://x.test/midterms/wall/senate", reload: vi.fn(), assign: vi.fn() } });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("mock election night", () => {
  it("is shared through localStorage, so every tab and wall runs it", async () => {
    browser();
    const { readMock, setMock } = await import("../lib/midterms/clock");
    setMock(18, 60);
    expect(readMock()).toMatchObject({ speed: 60 });
  });

  it("ends by itself after MOCK_TTL", async () => {
    const store = browser();
    const { readMock, MOCK_TTL } = await import("../lib/midterms/clock");
    store.set("mt-mock", JSON.stringify({ start: 1, at: Date.now() - MOCK_TTL - 1, speed: 1 }));
    expect(readMock()).toBeNull();
    store.set("mt-mock", JSON.stringify({ start: 1, at: Date.now() - MOCK_TTL + 60_000, speed: 1 }));
    expect(readMock()).not.toBeNull();
  });

  it("reloads a tab when another tab starts or stops it", async () => {
    browser();
    await import("../lib/midterms/clock");
    const w = window as unknown as { addEventListener: ReturnType<typeof vi.fn>; location: { reload: ReturnType<typeof vi.fn> } };
    const [, onStorage] = w.addEventListener.mock.calls.find(([type]) => type === "storage")!;
    onStorage({ key: "other" });
    expect(w.location.reload).not.toHaveBeenCalled();
    onStorage({ key: "mt-mock" });
    expect(w.location.reload).toHaveBeenCalledOnce();
  });
});

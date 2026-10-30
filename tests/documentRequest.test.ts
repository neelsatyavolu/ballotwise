import { describe, expect, it } from "vitest";
import { isDocumentRequest } from "../lib/midterms/documentRequest";

const headers = (values: Record<string, string>) => ({
  get: (name: string) => values[name] ?? null,
});

describe("isDocumentRequest", () => {
  it("seeds a browser page load and skips the app router's flight request", () => {
    expect(isDocumentRequest(headers({ "sec-fetch-dest": "document", accept: "text/html" }))).toBe(true);
    expect(isDocumentRequest(headers({ "sec-fetch-dest": "empty", accept: "*/*" }))).toBe(false);
    expect(isDocumentRequest(headers({ "sec-fetch-dest": "document", "next-url": "/midterms" }))).toBe(false);
  });

  it("falls back to Accept when the browser sends no fetch metadata", () => {
    expect(isDocumentRequest(headers({ accept: "text/html,application/xhtml+xml" }))).toBe(true);
    expect(isDocumentRequest(headers({ accept: "*/*" }))).toBe(false);
    expect(isDocumentRequest(headers({}))).toBe(false);
  });
});

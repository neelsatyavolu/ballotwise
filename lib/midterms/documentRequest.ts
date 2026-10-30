/**
 * A full page load, as opposed to the app router's flight request.
 * Next hides the `rsc` header from `headers()`, so this uses what the browser sends:
 * `Sec-Fetch-Dest: document` on a real navigation, and `Accept: text/html` when that header is absent.
 * A client navigation is a `fetch` (`Sec-Fetch-Dest: empty`) and sometimes carries `next-url`.
 */
export function isDocumentRequest(h: { get(name: string): string | null }): boolean {
  if (h.get("next-url")) return false;
  const dest = h.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (h.get("accept") ?? "").includes("text/html");
}

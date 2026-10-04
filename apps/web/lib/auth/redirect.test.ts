import { describe, expect, it } from "vitest";

import { DEFAULT_REDIRECT, safeRedirectPath } from "./redirect";

describe("safeRedirectPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/tenants/123", "/app/tenants/123"],
    ["/app?tab=members", "/app?tab=members"],
    ["/app?q=a%20b", "/app?q=a%20b"],
    ["/app#section", "/app"], // fragment dropped; it never reaches the server anyway
    ["/", "/"],
  ])("allows the relative path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    "//evil.example",
    "//evil.example/app",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "\\/evil.example",
    "https://evil.example",
    "http://evil.example/app",
    "HTTPS://evil.example",
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "evil.example",
    "app",
    "./app",
    "../app",
    "",
    " /app",
    "/app ",
    "/ /evil.example",
    "/\t/evil.example", // browsers strip tabs: becomes //evil.example
    "/\n/evil.example",
    "/\r/evil.example",
    "/\u0000/evil.example",
    "/%2f%2fevil.example", // decodes to //evil.example
    "/%2F%2Fevil.example",
    "/%5Cevil.example", // decodes to /\evil.example
    "/%5cevil.example",
    "/%09/evil.example",
    "/%0a/evil.example",
    "/%0d%0aSet-Cookie:x=1",
    "/%E0%A4%A", // malformed percent-encoding
    "/login",
    "/login?next=/app",
    "/login/anything",
  ])("rejects %j", (input) => {
    expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT);
  });

  it.each([null, undefined, 42, {}, [], ["/app"], true])(
    "rejects non-string %j",
    (input) => {
      expect(safeRedirectPath(input)).toBe(DEFAULT_REDIRECT);
    },
  );

  it("rejects absurdly long input", () => {
    expect(safeRedirectPath("/" + "a".repeat(5000))).toBe(DEFAULT_REDIRECT);
  });

  it("never returns anything that is not a same-origin path", () => {
    const samples = [
      "/a",
      "//b",
      "/\\c",
      "http://d",
      "/e?f=//g",
      "/%2f%2fh",
      "/i/../../j",
    ];
    for (const sample of samples) {
      const result = safeRedirectPath(sample);
      expect(result.startsWith("/")).toBe(true);
      expect(result.startsWith("//")).toBe(false);
      expect(result).not.toContain("\\");
      expect(new URL(result, "https://app.example").origin).toBe(
        "https://app.example",
      );
    }
  });

  it("honours a custom fallback", () => {
    expect(safeRedirectPath("//evil.example", "/home")).toBe("/home");
  });
});

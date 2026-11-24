import test from "node:test";
import assert from "node:assert/strict";
import { htmlElementPolicy, safeMailLink, safeMailImage, safeTableSpan } from "../src/lib/mail-html-policy.ts";

test("active and foreign namespace HTML is rejected", () => {
  const html = "http://www.w3.org/1999/xhtml";
  for (const tag of ["script", "style", "iframe", "form", "svg", "math", "link", "template"]) {
    assert.equal(htmlElementPolicy(tag, html), "drop");
  }
  assert.equal(htmlElementPolicy("a", "http://www.w3.org/2000/svg"), "drop");
  assert.equal(htmlElementPolicy("table", html), "allow");
  assert.equal(htmlElementPolicy("custom-element", html), "unwrap");
});

test("mail links reject local and active URL schemes", () => {
  for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hello",
    "//example.com", "/relative", "https://user:pass@example.com", "https://example.com\n", "https:example.com"]) {
    assert.equal(safeMailLink(url), null, url);
  }
  assert.equal(safeMailLink("https://example.com"), "https://example.com/");
  assert.equal(safeMailLink("mailto:hello@example.com"), "mailto:hello@example.com");
});

test("remote images require opt-in and HTTPS; only raster data is supported", () => {
  assert.deepEqual(safeMailImage("https://example.com/image.png", false), { kind: "blocked" });
  assert.deepEqual(safeMailImage("https://example.com/image.png", true), { kind: "allow", src: "https://example.com/image.png" });
  for (const url of ["//example.com/pixel", "file:///image.png", "http://example.com/image.png",
    "blob:https://example.com/id", "data:image/svg+xml;base64,PHN2Zz4=", "https://user@example.com/image.png"]) {
    assert.deepEqual(safeMailImage(url, true), { kind: "drop" }, url);
  }
  assert.equal(safeMailImage("data:image/png;base64,AA==", false).kind, "allow");
  assert.equal(safeTableSpan("100"), "100");
  assert.equal(safeTableSpan("101"), null);
  assert.equal(safeTableSpan("0"), null);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const rule = (selector: string): string => {
  const start = css.indexOf(selector + "{");
  assert.notEqual(start, -1, selector + " is missing");
  return css.slice(start + selector.length + 1, css.indexOf("}", start));
};

test("the desktop grid has an explicit bounded row at every UI scale", () => {
  assert.match(rule(".app-shell"), /height:calc\(100vh\s*\/\s*var\(--ui-scale,1\)\)/);
  assert.match(rule(".app-shell"), /grid-template-rows:minmax\(0,1fr\)/);
  assert.match(rule(".main"), /min-height:0/);
  assert.match(rule(".content"), /min-height:0/);
});

test("workspace overflow is constrained and settings retain a scrollbar", () => {
  assert.match(rule(".workspace"), /max-height:100%/);
  assert.match(rule(".workspace"), /min-height:0/);
  assert.match(rule(".workspace"), /overflow:auto/);
  assert.match(rule(".settings-workspace"), /overflow-y:scroll/);
  assert.match(rule(".settings-workspace"), /scrollbar-gutter:stable/);
});

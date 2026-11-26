import test from "node:test";
import assert from "node:assert/strict";
import { connectionGuidance } from "../src/lib/connection-guidance.ts";

test("Gmail app-password errors provide actionable guidance", () => {
  for (const error of [
    "IMAP: Application-specific password required · SMTP: permanent error (534): 5.7.9 Application-specific password required",
    "SMTP: 534-5.7.9 Please log in",
    "https://support.google.com/mail/?p=InvalidSecondFactor",
  ]) {
    const help = connectionGuidance(error,"test@gmail.com","gmail");
    assert.ok(help);
    assert.equal(help.steps.length,3);
    assert.ok(help.links.some(link=>link.url==="https://myaccount.google.com/apppasswords"));
  }
});

test("manual Gmail and Google Workspace accounts can receive Gmail guidance", () => {
  assert.ok(connectionGuidance("Application-specific password required","test@googlemail.com","imap"));
  assert.ok(connectionGuidance("Application-specific password required","test@example.com","gmail"));
});

test("unrelated errors and other providers retain their original details", () => {
  assert.equal(connectionGuidance("connection timed out","test@gmail.com","gmail"),null);
  assert.equal(connectionGuidance("authentication rejected","test@gmail.com","gmail"),null);
  assert.equal(connectionGuidance("534 5.7.9","test@example.com","imap"),null);
});

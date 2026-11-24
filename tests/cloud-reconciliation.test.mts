import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDocuments } from "../src/lib/cloud-reconciliation.ts";

const base = { id: "doc", kind: "note" as const, updatedAt: "2026-11-24T10:00:00Z", payload: { a: 1, b: 2 } };
test("same-version identical payload is independent of key order", () => {
  assert.equal(reconcileDocuments(base, {...base,payload:{b:2,a:1}}), "equal");
});
test("same-version divergent payload is a conflict", () => {
  assert.equal(reconcileDocuments(base, {...base,payload:{a:3,b:2}}), "conflict");
});
test("newer documents win without rewriting equal records", () => {
  const newer = {...base,updatedAt:"2026-11-24T10:01:00Z"};
  assert.equal(reconcileDocuments(base,newer),"remote");
  assert.equal(reconcileDocuments(newer,base),"local");
});
test("tombstone wins even against a newer live snapshot", () => {
  const deleted = {...base,deletedAt:base.updatedAt};
  const newer = {...base,updatedAt:"2026-11-24T10:01:00Z"};
  assert.equal(reconcileDocuments(newer,deleted),"remote");
  assert.equal(reconcileDocuments(deleted,newer),"local");
});
test("invalid timestamps and mismatched identities fail closed", () => {
  assert.throws(()=>reconcileDocuments(base,{...base,updatedAt:"invalid"}));
  assert.throws(()=>reconcileDocuments(base,{...base,id:"other"}));
});

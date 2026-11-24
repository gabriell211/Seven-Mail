import test from "node:test";
import assert from "node:assert/strict";
import { reconcileDocuments, sameProjection } from "../src/lib/cloud-reconciliation.ts";

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

test("server baseline requires matching local mirrored values", () => {
  const local = {id:"message",owner_id:"owner",sender:{email:"a@example.com",name:"A"},is_read:false};
  assert.equal(sameProjection(local,{id:"message",sender:{name:"A",email:"a@example.com"},is_read:false,updated_at:"2026-11-24T10:00:00Z"}),true);
  assert.equal(sameProjection(local,{id:"message",sender:{email:"a@example.com",name:"A"},is_read:true}),false);
  assert.equal(sameProjection(local,{id:"message",is_read:false}),false);
});

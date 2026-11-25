import test from "node:test";
import assert from "node:assert/strict";
import { compareVersionTimestamps, reconcileDocuments, sameProjection } from "../src/lib/cloud-reconciliation.ts";

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

test("workspace versions retain PostgreSQL microseconds and chrono nanoseconds", () => {
  const older = {...base, updatedAt:"2026-11-24T10:00:00.123456000Z"};
  const newer = {...base, updatedAt:"2026-11-24T10:00:00.123457Z", payload:{a:3,b:2}};
  assert.equal(reconcileDocuments(older,newer),"remote");
  assert.equal(reconcileDocuments(newer,older),"local");
  assert.equal(compareVersionTimestamps("2026-11-24T10:00:00.123456001Z",older.updatedAt),1);
  assert.equal(compareVersionTimestamps("2026-11-24T07:00:00.123456-03:00",older.updatedAt),0);
  assert.equal(compareVersionTimestamps("1969-12-31T23:59:59.999999999Z","1970-01-01T00:00:00Z"),-1);
  assert.throws(()=>compareVersionTimestamps("2026-02-30T10:00:00Z",older.updatedAt));
  assert.throws(()=>compareVersionTimestamps("2026-11-24T10:00:00",older.updatedAt));
});
test("tombstone version retains submillisecond precision", () => {
  const older = {...base, updatedAt:"2026-11-24T10:00:00.123456Z", deletedAt:"2026-11-24T10:00:00.123457Z"};
  const newer = {...older, deletedAt:"2026-11-24T10:00:00.123458Z"};
  assert.equal(reconcileDocuments(older,newer),"remote");
});

import test from "node:test";
import assert from "node:assert/strict";
import { createNeonHttpAuth, validatedHttpsEndpoint } from "../src/lib/neon-auth-http.ts";

const base = "https://example.invalid/auth";
const session = { user: { id: "owner-1", name: "Example", email: "mail@example.invalid" }, session: { id: "session-1", userId: "owner-1", token: "opaque-session" } };

test("auth uses HTTPS, cookie sessions, and only signed-token header for data access", async () => {
  const mock: typeof fetch = async (input, init) => {
    assert.equal(String(input), base + "/get-session");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    return Response.json(session, { headers: { "set-auth-jwt": "header.payload.signature" } });
  };
  const auth = createNeonHttpAuth(base, mock);
  const result = await auth.getSession();
  assert.equal(result.data?.user.id, "owner-1");
  assert.equal(result.error, null);
  assert.ok(!JSON.stringify(result).includes("opaque-session"));
  assert.equal(await auth.getJWTToken(), "header.payload.signature");
});

test("opaque session token and unauthenticated responses never authorize data access", async () => {
  const noHeader: typeof fetch = async () => Response.json(session);
  assert.equal(await createNeonHttpAuth(base, noHeader).getJWTToken(), null);
  const anonymous: typeof fetch = async () => Response.json(null, { headers: { "set-auth-jwt": "header.payload.signature" } });
  assert.equal(await createNeonHttpAuth(base, anonymous).getJWTToken(), null);
  const mismatch: typeof fetch = async () => Response.json({ ...session, session: { ...session.session, userId: "other" } });
  assert.ok((await createNeonHttpAuth(base, mismatch).getSession()).error);
  await assert.rejects(createNeonHttpAuth(base, mismatch).getJWTToken());
});

test("email login, registration and sign-out use explicit POST endpoints", async () => {
  const calls: string[] = [];
  const mock: typeof fetch = async (input, init) => {
    calls.push(String(input));
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "include");
    assert.equal(init?.redirect, "error");
    return Response.json({});
  };
  const auth = createNeonHttpAuth(base, mock);
  assert.equal((await auth.signIn.email({ email: "a@example.invalid", password: "fixture-password" })).error, null);
  assert.equal((await auth.signUp.email({ email: "a@example.invalid", name: "Fixture", password: "fixture-password" })).error, null);
  assert.equal((await auth.signOut()).error, null);
  assert.deepEqual(calls, [base + "/sign-in/email", base + "/sign-up/email", base + "/sign-out"]);
});

test("authentication errors do not expose remote response contents or credentials", async () => {
  const mock: typeof fetch = async () => Response.json({ message: "private-fixture" }, { status: 401 });
  const result = await createNeonHttpAuth(base, mock).getSession();
  assert.ok(result.error);
  assert.ok(!JSON.stringify(result).includes("private-fixture"));
  for (const url of ["http://example.invalid/auth", "https://user:pass@example.invalid/auth", "https://example.invalid/auth?secret=x", "https://example.invalid/auth#fragment"]) {
    assert.throws(() => validatedHttpsEndpoint(url));
  }
});

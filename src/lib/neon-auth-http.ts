// Minimal client for the existing Neon Auth HTTP endpoints. Authentication
// and JWT signing remain on Neon; no local credentials or tokens are persisted.
type User = { id: string; name: string; email: string };
type Session = { user: User; session: { id: string; userId: string } };
type AuthResult<T> = { data: T | null; error: { message: string } | null };
type Endpoint = "get-session" | "sign-in/email" | "sign-up/email" | "sign-out";

export function validatedHttpsEndpoint(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.search || url.hash) {
    throw new Error("Endpoint Neon deve ser HTTPS, sem credenciais, query ou fragmento.");
  }
  return url;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseSession(value: unknown): Session | null {
  if (value === null) return null;
  const body = record(value);
  const user = record(body?.user);
  const session = record(body?.session);
  if (!user || !session || typeof user.id !== "string" || !user.id ||
      typeof user.name !== "string" || typeof user.email !== "string" ||
      typeof session.id !== "string" || !session.id || session.userId !== user.id) {
    throw new Error("Resposta de sessão Neon inválida.");
  }
  return { user: { id: user.id, name: user.name, email: user.email },
    session: { id: session.id, userId: user.id } };
}

export function createNeonHttpAuth(baseUrl: string, request: typeof fetch = fetch) {
  const base = validatedHttpsEndpoint(baseUrl);
  base.pathname = base.pathname.replace(/\/+$/, "") + "/";
  async function call(endpoint: Endpoint, body?: object): Promise<Response> {
    const response = await request(new URL(endpoint, base), {
      method: endpoint === "get-session" ? "GET" : "POST",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error("Neon Auth recusou a solicitação (HTTP " + response.status + ").");
    return response;
  }

  async function sessionAndToken(): Promise<{ data: Session | null; jwt: string | null }> {
    const response = await call("get-session");
    const data = parseSession(await response.json());
    // The JSON session.token is an opaque session identifier. Only the
    // provider's signed JWT response header may authorize Data API calls.
    const header = response.headers.get("set-auth-jwt");
    const jwt = data && header && header.length <= 16384 &&
      /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(header) ? header : null;
    return { data, jwt };
  }

  async function result<T>(action: () => Promise<T | null>): Promise<AuthResult<T>> {
    try { return { data: await action(), error: null }; }
    catch { return { data: null, error: { message: "Não foi possível concluir a solicitação ao Neon Auth." } }; }
  }

  async function mutate(endpoint: Exclude<Endpoint, "get-session">, body?: object): Promise<AuthResult<null>> {
    return result<null>(async () => { await call(endpoint, body); return null; });
  }

  return {
    getSession: () => result<Session>(async () => (await sessionAndToken()).data),
    getJWTToken: async (): Promise<string | null> => (await sessionAndToken()).jwt,
    signIn: { email: (body: { email: string; password: string }) => mutate("sign-in/email", body) },
    signUp: { email: (body: { name: string; email: string; password: string }) => mutate("sign-up/email", body) },
    signOut: () => mutate("sign-out", {}),
  };
}

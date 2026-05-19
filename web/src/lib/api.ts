/**
 * Cliente HTTP tipado pro Fastify do bot. Roda sempre no SERVIDOR
 * (Server Components / Server Actions / Route Handlers do Next) — o
 * navegador NUNCA bate direto no bot, sempre via Next, pra que:
 *
 * - O cookie de sessao httpOnly fique no mesmo origin (vardobolao.com.br),
 *   sem CORS pro browser.
 * - A URL interna do bot (rede privada Railway) nao vaze.
 *
 * Em prod, BOT_API_URL pode apontar pra http://var-do-bolao.railway.internal:3000
 * (rede interna), e o Next faz proxy.
 */
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "./session";

const BASE = process.env.BOT_API_URL ?? "http://localhost:3000";

type FetchOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  forwardCookies?: boolean; // default true em prod, sempre true qd usuario logado
};

export class ApiError extends Error {
  constructor(
    public status: number,
    public payload: unknown,
  ) {
    super(`API ${status}`);
  }
}

export async function botFetch<T = unknown>(
  path: string,
  opts: FetchOpts = {},
): Promise<T> {
  const url = `${BASE}${path}`;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  // Encaminha cookies de sessao do navegador pro bot
  if (opts.forwardCookies !== false) {
    const cookieStore = await cookies();
    const session = cookieStore.get(SESSION_COOKIE_NAME);
    const preCadastro = cookieStore.get("vdb_pre_cadastro");
    const cookieHeader = [
      session ? `${session.name}=${session.value}` : null,
      preCadastro ? `${preCadastro.name}=${preCadastro.value}` : null,
    ]
      .filter(Boolean)
      .join("; ");
    if (cookieHeader) headers.cookie = cookieHeader;
  }

  const res = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
    // @ts-expect-error — Next 15: undici aceita "set-cookie" forward via callback
    duplex: "half",
  });

  // Forward de Set-Cookie do bot -> browser quando vier
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length > 0) {
    const cookieStore = await cookies();
    for (const raw of setCookie) {
      // raw eh tipo "vdb_session=xxx; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000"
      const [pair, ...rest] = raw.split(";").map((s) => s.trim());
      const [name, ...valParts] = pair.split("=");
      const value = valParts.join("=");
      const attrs = Object.fromEntries(
        rest.map((a) => {
          const [k, v] = a.split("=");
          return [k.toLowerCase(), v ?? true];
        }),
      );
      cookieStore.set({
        name,
        value,
        httpOnly: "httponly" in attrs,
        secure: "secure" in attrs,
        sameSite: (attrs["samesite"] as "lax" | "strict" | "none" | undefined) ?? "lax",
        path: (attrs["path"] as string) ?? "/",
        maxAge: attrs["max-age"]
          ? Number(attrs["max-age"])
          : undefined,
      });
    }
  }

  const text = await res.text();
  const payload = text ? safeJson(text) : null;

  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

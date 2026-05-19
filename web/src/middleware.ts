import { NextResponse, type NextRequest } from "next/server";

/**
 * Protege /app/* — sem cookie de sessao, redireciona pro /login.
 * Validacao real do HMAC do cookie acontece no Fastify do bot; aqui
 * so checamos presenca (rapido, sem precisar do secret).
 */
const SESSION_COOKIE = "vdb_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/app")) return NextResponse.next();

  const has = req.cookies.has(SESSION_COOKIE);
  if (has) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/app/:path*"],
};

/**
 * Helpers de sessao no Next. O cookie em si eh setado pelo Fastify do
 * bot via Set-Cookie no fluxo de login — o api-client (lib/api.ts) faz
 * o forward pro browser. Aqui so lemos.
 */
import { cookies } from "next/headers";

export const SESSION_COOKIE_NAME = "vdb_session";

export async function hasSessionCookie(): Promise<boolean> {
  const store = await cookies();
  return !!store.get(SESSION_COOKIE_NAME)?.value;
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

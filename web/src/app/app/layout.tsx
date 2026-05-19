import { redirect } from "next/navigation";
import { ApiError, botFetch } from "@/lib/api";
import { AppHeader } from "@/components/app/AppHeader";
import { Footer } from "@/components/landing/Footer";

export type MeData = {
  id: string;
  nome: string;
  celular: string;
  email: string;
  dataNascimento: string | null;
  emailVerificado: boolean;
  criadoEm: string;
};

async function getMe(): Promise<MeData> {
  try {
    return await botFetch<MeData>("/api/me");
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 404)) {
      redirect("/login");
    }
    throw e;
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const me = await getMe();
  return (
    <>
      <AppHeader nome={me.nome} />
      <main className="min-h-[calc(100dvh-4rem)]">{children}</main>
      <Footer />
    </>
  );
}

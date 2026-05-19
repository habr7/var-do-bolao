import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { UserPlus } from "lucide-react";
import { PageShell } from "@/components/landing/PageShell";
import { Container } from "@/components/ui/Container";
import { PrimeiroAcessoClient } from "./PrimeiroAcessoClient";

export const metadata: Metadata = {
  title: "Primeiro acesso",
  description: "Complete seu cadastro no VAR do Bolão.",
  robots: { index: false, follow: false },
};

export default async function PrimeiroAcessoPage() {
  const store = await cookies();
  const pre = store.get("vdb_pre_cadastro")?.value;
  if (!pre) redirect("/login");

  return (
    <PageShell>
      <Container className="py-12 md:py-20">
        <div className="mx-auto max-w-md">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-verde-conexao)]/15 text-[var(--color-verde-conexao)]">
              <UserPlus size={28} />
            </div>
            <h1 className="font-[var(--font-display)] text-3xl uppercase md:text-4xl">
              Primeira vez por aqui
            </h1>
            <p className="mt-3 text-white/70">
              Já te conhecemos pelo bot — completa só os dados pra entrar pelo site.
            </p>
          </div>

          <div className="mt-10 rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/70 p-6">
            <PrimeiroAcessoClient />
          </div>
        </div>
      </Container>
    </PageShell>
  );
}

import type { Metadata } from "next";
import { botFetch } from "@/lib/api";
import { Container } from "@/components/ui/Container";
import { PerfilClient } from "./PerfilClient";
import type { MeData } from "../layout";

export const metadata: Metadata = {
  title: "Meu perfil",
  robots: { index: false, follow: false },
};

export default async function PerfilPage() {
  const me = await botFetch<MeData>("/api/me");

  return (
    <Container className="py-10 md:py-16">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-verde-conexao)]">
          Conta
        </p>
        <h1 className="mt-1 font-[var(--font-display)] text-3xl uppercase md:text-4xl">
          Meu perfil
        </h1>
      </header>
      <div className="mx-auto max-w-2xl rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/70 p-6 md:p-8">
        <PerfilClient
          nome={me.nome}
          email={me.email}
          celular={me.celular}
          dataNascimento={me.dataNascimento}
        />
      </div>
    </Container>
  );
}

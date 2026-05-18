import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Smartphone } from "lucide-react";
import { PageShell } from "@/components/landing/PageShell";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CTA_CRIAR_BOLAO, CTA_FALAR_BOT } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Entrar",
  description: "Entre na sua conta do VAR do Bolão com seu número de WhatsApp.",
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <PageShell>
      <Container className="py-16 md:py-24">
        <div className="mx-auto max-w-md">
          <div className="text-center">
            <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-verde-conexao)]/15 text-[var(--color-verde-conexao)]">
              <Smartphone size={28} />
            </div>
            <h1 className="font-[var(--font-display)] text-3xl uppercase md:text-4xl">
              Entrar
            </h1>
            <p className="mt-3 text-white/70">
              A entrada na área logada vai chegar em breve. Por enquanto, fala
              direto com o bot pra criar bolão, entrar ou palpitar.
            </p>
          </div>

          <form
            className="mt-10 space-y-4 rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/70 p-6 opacity-60"
            aria-disabled
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="block">
              <span className="mb-2 block text-sm font-semibold text-white/90">
                Celular com DDD
              </span>
              <input
                type="tel"
                placeholder="+55 (11) 99999-9999"
                disabled
                className="w-full rounded-lg border border-white/15 bg-white/[0.04] px-4 py-3 text-white placeholder:text-white/30 focus:border-[var(--color-verde-conexao)] focus:outline-none disabled:cursor-not-allowed"
              />
            </label>
            <button
              type="button"
              disabled
              className="inline-flex w-full items-center justify-center rounded-full bg-white/15 px-5 py-3 font-semibold text-white/70"
            >
              Receber código por WhatsApp · em breve
            </button>
            <p className="text-center text-xs text-white/45">
              Mandamos um código de 6 dígitos pelo bot. Vale por 10 minutos.
            </p>
          </form>

          <div className="mt-8 rounded-2xl border border-[var(--color-amarelo-arbitro)]/30 bg-[var(--color-amarelo-arbitro)]/[0.06] p-5">
            <p className="text-sm text-white/85">
              <strong className="text-[var(--color-amarelo-arbitro)]">Login web em construção.</strong>{" "}
              O bot já funciona 100% pelo WhatsApp e é o jeito mais rápido de
              começar.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Button href={CTA_CRIAR_BOLAO} variant="primary" size="md">
                <MessageCircle size={16} /> Criar bolão
              </Button>
              <Button href={CTA_FALAR_BOT} variant="secondary" size="md">
                Falar com o bot
              </Button>
            </div>
          </div>

          <p className="mt-8 text-center text-xs text-white/45">
            Ao entrar, você concorda com nossa{" "}
            <Link href="/politica-privacidade" className="underline hover:text-white">
              Política de Privacidade
            </Link>{" "}
            e os{" "}
            <Link href="/termos" className="underline hover:text-white">
              Termos
            </Link>
            .
          </p>
        </div>
      </Container>
    </PageShell>
  );
}

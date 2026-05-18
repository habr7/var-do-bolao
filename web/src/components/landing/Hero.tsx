import { ArrowRight, MessageCircle } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CTA_CRIAR_BOLAO } from "@/lib/constants";

export function Hero() {
  return (
    <section className="relative overflow-hidden pt-32 pb-20 md:pt-44 md:pb-28">
      {/* Halo verde sutil atras */}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-60"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--color-verde-conexao) 28%, transparent) 0%, transparent 70%)",
        }}
      />

      <Container className="relative">
        <div className="mx-auto max-w-4xl text-center">
          {/* Badge superior */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[var(--color-verde-conexao)]/40 bg-[var(--color-verde-conexao)]/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-verde-conexao)]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-verde-conexao)] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-verde-conexao)]" />
            </span>
            Pronto pra Copa do Mundo FIFA 2026
          </div>

          <h1 className="font-[var(--font-display)] text-5xl uppercase leading-[0.95] tracking-tight md:text-7xl">
            A resenha do grupo
            <br />
            <span className="text-[var(--color-verde-conexao)]">
              com a precisão dos dados.
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base text-white/85 md:text-xl">
            Bolão de Copa do Mundo <strong>100% no WhatsApp</strong>. Sem app,
            sem planilha, sem cadastro chato. Cria, palpita e ranqueia — tudo
            por chat.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={CTA_CRIAR_BOLAO} variant="primary" size="lg">
              <MessageCircle size={20} />
              Criar bolão grátis no WhatsApp
            </Button>
            <Button href="/login" variant="secondary" size="lg">
              Já participo
              <ArrowRight size={18} />
            </Button>
          </div>

          {/* Trust mini */}
          <div className="mt-12 grid grid-cols-3 gap-4 text-center md:gap-8">
            <Stat value="72" label="jogos da Copa 2026" />
            <Stat value="100%" label="no WhatsApp" />
            <Stat value="0" label="planilhas" />
          </div>
        </div>
      </Container>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-[var(--font-display)] text-3xl text-[var(--color-amarelo-arbitro)] md:text-5xl">
        {value}
      </div>
      <div className="mt-1 text-xs uppercase tracking-wider text-white/60 md:text-sm">
        {label}
      </div>
    </div>
  );
}

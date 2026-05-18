import type { Metadata } from "next";
import { MessageCircle, Trophy } from "lucide-react";
import { PageShell } from "@/components/landing/PageShell";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CTA_CRIAR_BOLAO, CTA_FALAR_BOT } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Meus bolões",
  description: "Dashboard com seus bolões, ranking e palpites.",
  robots: { index: false, follow: false },
};

const MOCK_BOLOES = [
  {
    nome: "Bolão da Firma",
    codigo: "K3MZ8P",
    admin: true,
    posicao: 3,
    total: 12,
    pontos: 47,
    proximoJogo: { times: "Brasil × Marrocos", emHoras: 2, faltaPalpite: true },
  },
  {
    nome: "Bolão da Galera",
    codigo: "X7M2QN",
    admin: false,
    posicao: 1,
    total: 8,
    pontos: 89,
    proximoJogo: null,
  },
];

export default function DashboardPage() {
  return (
    <PageShell backLabel="Sair">
      <Container className="py-10 md:py-16">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <p className="text-sm text-white/60">Olá,</p>
            <h1 className="font-[var(--font-display)] text-3xl uppercase md:text-4xl">
              Humberto <span className="text-white/40 text-lg">(preview)</span>
            </h1>
          </div>
        </div>

        <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-verde-conexao)]">
          Meus bolões
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          {MOCK_BOLOES.map((b) => (
            <article
              key={b.codigo}
              className="rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/80 p-6"
            >
              <header className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-[var(--font-display)] text-lg uppercase">
                    {b.nome}
                  </h3>
                  <p className="mt-1 text-xs text-white/55">
                    Código #{b.codigo}
                  </p>
                </div>
                {b.admin ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-amarelo-arbitro)]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-amarelo-arbitro)]">
                    Admin
                  </span>
                ) : null}
              </header>

              <div className="grid grid-cols-2 gap-3 rounded-xl bg-black/20 p-4">
                <div>
                  <p className="text-xs text-white/55">Posição</p>
                  <p className="mt-1 font-[var(--font-display)] text-2xl">
                    {b.posicao}º
                    <span className="ml-1 text-sm text-white/45">/ {b.total}</span>
                  </p>
                </div>
                <div>
                  <p className="text-xs text-white/55">Pontos</p>
                  <p className="mt-1 font-[var(--font-display)] text-2xl text-[var(--color-verde-conexao)]">
                    {b.pontos}
                  </p>
                </div>
              </div>

              {b.proximoJogo ? (
                <div className="mt-4 rounded-xl border border-white/10 bg-black/15 p-4">
                  <p className="text-xs uppercase tracking-wider text-white/55">
                    Próximo jogo · em {b.proximoJogo.emHoras}h
                  </p>
                  <p className="mt-1 font-semibold">{b.proximoJogo.times}</p>
                  {b.proximoJogo.faltaPalpite ? (
                    <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-amarelo-arbitro)]/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-amarelo-arbitro)]">
                      ⚠ Falta palpitar
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--color-verde-conexao)]/20 bg-[var(--color-verde-conexao)]/[0.06] p-4 text-sm">
                  <Trophy size={16} className="text-[var(--color-verde-conexao)]" />
                  Liderando o bolão. Bora segurar.
                </div>
              )}
            </article>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-white/10 bg-[var(--color-verde-gramado-deep)]/60 p-6 text-sm text-white/80">
          <p>
            <strong className="text-white">Pra palpitar ou criar bolão</strong>, fala
            direto com o bot no WhatsApp. A área logada é só pra consulta nesta fase.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button href={CTA_FALAR_BOT} variant="primary" size="md">
              <MessageCircle size={16} /> Abrir conversa
            </Button>
            <Button href={CTA_CRIAR_BOLAO} variant="secondary" size="md">
              Criar bolão novo
            </Button>
          </div>
        </div>

        <p className="mt-8 text-center text-xs text-white/40">
          Dados mockados — versão preview da área logada. Integração com banco
          chega na Fase 2 do roadmap.
        </p>
      </Container>
    </PageShell>
  );
}

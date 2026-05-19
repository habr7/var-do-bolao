import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Crown, MessageCircle, Trophy } from "lucide-react";
import { botFetch } from "@/lib/api";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CTA_CRIAR_BOLAO, CTA_ENTRAR_BOLAO, CTA_FALAR_BOT } from "@/lib/constants";
import { relativeTime } from "@/lib/format";

export const metadata: Metadata = {
  title: "Meus bolões",
  description: "Dashboard com seus bolões, ranking e palpites.",
  robots: { index: false, follow: false },
};

type BolaoCard = {
  id: string;
  codigo: string;
  nome: string;
  status: "ATIVO" | "PAUSADO" | "FINALIZADO";
  isAdmin: boolean;
  pontos: number;
  posicao: number | null;
  total: number;
  proximoJogo: { times: string; dataHora: string } | null;
  faltaPalpitar: boolean;
};

async function getBoloes(): Promise<BolaoCard[]> {
  const { boloes } = await botFetch<{ boloes: BolaoCard[] }>("/api/me/boloes");
  return boloes;
}

export default async function DashboardPage() {
  const boloes = await getBoloes();

  return (
    <Container className="py-10 md:py-16">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[var(--font-display)] text-3xl uppercase md:text-4xl">
            Meus bolões
          </h1>
          <p className="mt-1 text-sm text-white/60">
            {boloes.length === 0
              ? "Você ainda não está em nenhum bolão."
              : `Você participa de ${boloes.length} ${boloes.length === 1 ? "bolão" : "bolões"}.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={CTA_CRIAR_BOLAO} variant="primary" size="md">
            <MessageCircle size={16} /> Criar bolão
          </Button>
          <Button href={CTA_ENTRAR_BOLAO} variant="secondary" size="md">
            Entrar em bolão
          </Button>
        </div>
      </div>

      {boloes.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {boloes.map((b) => (
            <BolaoCardItem key={b.id} bolao={b} />
          ))}
        </div>
      )}

      <div className="mt-12 rounded-2xl border border-white/10 bg-[var(--color-verde-gramado-deep)]/60 p-6 text-sm text-white/80">
        <p>
          <strong className="text-white">Pra palpitar ou editar palpite</strong>, fala
          direto com o bot no WhatsApp. A área logada é só pra consulta — assim
          o bot continua sendo a única fonte de verdade.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button href={CTA_FALAR_BOT} variant="primary" size="md">
            <MessageCircle size={16} /> Abrir conversa
          </Button>
        </div>
      </div>
    </Container>
  );
}

function BolaoCardItem({ bolao: b }: { bolao: BolaoCard }) {
  return (
    <Link
      href={`/app/bolao/${b.codigo}`}
      className="group relative block rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/80 p-6 transition-all hover:border-[var(--color-verde-conexao)]/40 hover:bg-[var(--color-cinza-card-hover)]"
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-[var(--font-display)] text-lg uppercase">
            {b.nome}
          </h3>
          <p className="mt-1 text-xs text-white/55">
            Código #{b.codigo}
            {b.status === "FINALIZADO" ? (
              <span className="ml-2 inline-flex items-center rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-white/55">
                🏁 Encerrado
              </span>
            ) : null}
          </p>
        </div>
        {b.isAdmin ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-amarelo-arbitro)]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--color-amarelo-arbitro)]">
            <Crown size={11} /> Admin
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-3 rounded-xl bg-black/20 p-4">
        <div>
          <p className="text-xs text-white/55">Posição</p>
          <p className="mt-1 font-[var(--font-display)] text-2xl">
            {b.posicao !== null ? `${b.posicao}º` : "—"}
            {b.total > 0 ? (
              <span className="ml-1 text-sm text-white/45">/ {b.total}</span>
            ) : null}
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
            Próximo jogo · {relativeTime(b.proximoJogo.dataHora)}
          </p>
          <p className="mt-1 font-semibold">{b.proximoJogo.times}</p>
          {b.faltaPalpitar ? (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-amarelo-arbitro)]/15 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[var(--color-amarelo-arbitro)]">
              ⚠ Falta palpitar
            </div>
          ) : null}
        </div>
      ) : b.posicao === 1 && b.total > 1 ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-[var(--color-verde-conexao)]/20 bg-[var(--color-verde-conexao)]/[0.06] p-4 text-sm">
          <Trophy size={16} className="text-[var(--color-verde-conexao)]" />
          Liderando o bolão. Bora segurar.
        </div>
      ) : null}

      <div className="mt-4 flex items-center justify-end text-xs font-semibold text-[var(--color-verde-conexao)] opacity-70 transition-opacity group-hover:opacity-100">
        Ver detalhes <ArrowRight size={14} className="ml-1" />
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--color-verde-conexao)]/15 text-[var(--color-verde-conexao)]">
        <Trophy size={28} />
      </div>
      <h2 className="font-[var(--font-display)] text-xl uppercase">
        Bolão zero. Por enquanto.
      </h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-white/65">
        Cria um bolão grátis (você vira admin) ou entra num que te convidaram.
        Tudo pelo WhatsApp.
      </p>
      <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
        <Button href={CTA_CRIAR_BOLAO} variant="primary" size="md">
          Criar bolão
        </Button>
        <Button href={CTA_ENTRAR_BOLAO} variant="secondary" size="md">
          Entrar em um existente
        </Button>
      </div>
    </div>
  );
}

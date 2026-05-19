import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Crown, MessageCircle, TrendingUp } from "lucide-react";
import { ApiError, botFetch } from "@/lib/api";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/app/Tabs";
import { RankingTab } from "@/components/app/RankingTab";
import { PalpitesTab } from "@/components/app/PalpitesTab";
import { JogosTab } from "@/components/app/JogosTab";
import { CTA_PALPITAR } from "@/lib/constants";

export const dynamic = "force-dynamic";

type RankingResp = {
  bolao: { id: string; codigo: string; nome: string; status: string };
  ranking: {
    posicao: number;
    usuarioId: string;
    nome: string;
    pontuacao: number;
    isVoce: boolean;
  }[];
};

type PalpitesResp = {
  rodadas: {
    rodada: number;
    rodadaStatus: "ABERTA" | "FECHADA" | "FINALIZADA";
    pontuacao: number;
    calculado: boolean;
    jogos: {
      jogoId: string;
      timeCasa: string;
      timeVisitante: string;
      golsCasaReais: number | null;
      golsVisitanteReais: number | null;
      statusJogo: string;
      palpiteCasa: number;
      palpiteVisitante: number;
      pontosObtidos: number;
      dataHora: string;
    }[];
  }[];
};

type JogosResp = {
  rodada: { numero: number; status: string } | null;
  jogos: {
    jogoId: string;
    timeCasa: string;
    timeVisitante: string;
    dataHora: string;
    status: string;
    jaPalpitou: boolean;
    palpiteCasa: number | null;
    palpiteVisitante: number | null;
  }[];
};

async function safeFetch<T>(path: string): Promise<T | null> {
  try {
    return await botFetch<T>(path);
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 401) redirect("/login");
      if (e.status === 404 || e.status === 403) return null;
    }
    throw e;
  }
}

export default async function BolaoPage({
  params,
  searchParams,
}: {
  params: Promise<{ codigo: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { codigo } = await params;
  const { tab } = await searchParams;
  const activeTab = (tab === "palpites" || tab === "jogos" ? tab : "ranking") as
    | "ranking"
    | "palpites"
    | "jogos";

  // Sempre buscamos ranking pra ter dados do bolao no header
  const ranking = await safeFetch<RankingResp>(`/api/boloes/${codigo}/ranking`);
  if (!ranking) notFound();

  return (
    <Container className="py-8 md:py-12">
      <Link
        href="/app"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-white"
      >
        <ArrowLeft size={14} /> Meus bolões
      </Link>

      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-verde-conexao)]">
              Bolão #{ranking.bolao.codigo}
            </p>
            <h1 className="mt-1 font-[var(--font-display)] text-3xl uppercase md:text-4xl">
              {ranking.bolao.nome}
            </h1>
          </div>
          <Button href={CTA_PALPITAR} variant="primary" size="md">
            <MessageCircle size={16} /> Palpitar pelo WhatsApp
          </Button>
        </div>
      </header>

      <Tabs
        codigo={codigo}
        active={activeTab}
        items={[
          { id: "ranking", label: "Ranking", icon: <Crown size={14} /> },
          { id: "palpites", label: "Meus palpites", icon: <TrendingUp size={14} /> },
          { id: "jogos", label: "Próximos jogos", icon: <MessageCircle size={14} /> },
        ]}
      />

      <section className="mt-6">
        {activeTab === "ranking" ? (
          <RankingTab ranking={ranking.ranking} />
        ) : null}
        {activeTab === "palpites" ? (
          <PalpitesTabLoader codigo={codigo} />
        ) : null}
        {activeTab === "jogos" ? <JogosTabLoader codigo={codigo} /> : null}
      </section>
    </Container>
  );
}

async function PalpitesTabLoader({ codigo }: { codigo: string }) {
  const data = await safeFetch<PalpitesResp>(`/api/boloes/${codigo}/meus-palpites`);
  if (!data) return null;
  return <PalpitesTab rodadas={data.rodadas} />;
}

async function JogosTabLoader({ codigo }: { codigo: string }) {
  const data = await safeFetch<JogosResp>(`/api/boloes/${codigo}/proximos-jogos`);
  if (!data) return null;
  return <JogosTab rodada={data.rodada} jogos={data.jogos} />;
}

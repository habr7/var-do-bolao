import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CTA_PALPITAR } from "@/lib/constants";

type Jogo = {
  jogoId: string;
  timeCasa: string;
  timeVisitante: string;
  golsCasaReais: number | null;
  golsVisitanteReais: number | null;
  statusJogo: string;
  palpiteCasa: number;
  palpiteVisitante: number;
  pontosObtidos: number;
};

type Rodada = {
  rodada: number;
  rodadaStatus: "ABERTA" | "FECHADA" | "FINALIZADA";
  pontuacao: number;
  calculado: boolean;
  jogos: Jogo[];
};

export function PalpitesTab({ rodadas }: { rodadas: Rodada[] }) {
  if (rodadas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 p-8 text-center">
        <p className="text-white/65">Nenhum palpite registrado ainda.</p>
        <div className="mt-4">
          <Button href={CTA_PALPITAR} variant="primary" size="md">
            Palpitar pelo WhatsApp
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {rodadas.map((r) => (
        <div key={r.rodada} className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03]">
          <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
            <div>
              <h3 className="font-[var(--font-display)] uppercase">
                Rodada {r.rodada}
              </h3>
              <p className="mt-0.5 text-xs text-white/55">
                {r.rodadaStatus === "ABERTA"
                  ? "Em aberto · ainda dá pra ajustar pelo bot"
                  : r.rodadaStatus === "FECHADA"
                    ? "Fechada · aguardando os jogos"
                    : "Encerrada"}
              </p>
            </div>
            <div className="text-right">
              <p className="font-[var(--font-display)] text-2xl text-[var(--color-verde-conexao)]">
                {r.pontuacao}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-white/45">
                pontos
              </p>
            </div>
          </header>
          <div className="divide-y divide-white/5">
            {r.jogos.map((j) => (
              <JogoRow key={j.jogoId} jogo={j} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JogoRow({ jogo: j }: { jogo: Jogo }) {
  const finalizado = j.statusJogo === "FINALIZADO";
  const exato =
    finalizado &&
    j.golsCasaReais === j.palpiteCasa &&
    j.golsVisitanteReais === j.palpiteVisitante;

  return (
    <div className="grid grid-cols-[1fr,auto,auto] items-center gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="truncate font-semibold">
          {j.timeCasa}{" "}
          <span className="text-white/40">×</span> {j.timeVisitante}
        </p>
        {finalizado ? (
          <p className="mt-0.5 text-xs text-white/55">
            Resultado:{" "}
            <strong className="text-white">
              {j.golsCasaReais}–{j.golsVisitanteReais}
            </strong>
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-white/45">
            {j.statusJogo === "AO_VIVO" ? "Ao vivo" : "Aguardando"}
          </p>
        )}
      </div>
      <div className="text-center">
        <p className="text-[10px] uppercase tracking-wider text-white/45">
          Palpite
        </p>
        <p className="font-[var(--font-display)] text-lg">
          {j.palpiteCasa}–{j.palpiteVisitante}
        </p>
      </div>
      <div
        className={`flex h-12 w-16 flex-col items-center justify-center rounded-lg text-center ${
          exato
            ? "bg-[var(--color-verde-conexao)]/20 text-[var(--color-verde-conexao)]"
            : finalizado && j.pontosObtidos > 0
              ? "bg-white/10 text-white"
              : finalizado
                ? "bg-red-500/10 text-red-300"
                : "bg-white/5 text-white/40"
        }`}
      >
        {finalizado ? (
          <>
            <span className="font-[var(--font-display)] text-base">{j.pontosObtidos}</span>
            <span className="text-[9px] uppercase tracking-wider">
              {exato ? <Check size={11} /> : j.pontosObtidos === 0 ? <X size={11} /> : "pts"}
            </span>
          </>
        ) : (
          <span className="text-[10px] uppercase tracking-wider">aberto</span>
        )}
      </div>
    </div>
  );
}

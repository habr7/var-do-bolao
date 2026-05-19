import { Crown } from "lucide-react";
import { cn } from "@/lib/cn";

type Row = {
  posicao: number;
  nome: string;
  pontuacao: number;
  isVoce: boolean;
};

export function RankingTab({ ranking }: { ranking: Row[] }) {
  if (ranking.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/15 p-8 text-center text-white/55">
        Ninguém pontuou ainda. Quando o primeiro jogo terminar, a tabela ganha vida.
      </p>
    );
  }
  return (
    <ol className="space-y-2">
      {ranking.map((r) => (
        <li
          key={r.posicao}
          className={cn(
            "flex items-center gap-4 rounded-xl border px-4 py-3",
            r.isVoce
              ? "border-[var(--color-verde-conexao)]/50 bg-[var(--color-verde-conexao)]/[0.08]"
              : "border-white/10 bg-white/[0.03]",
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-[var(--font-display)] text-sm",
              r.posicao === 1
                ? "bg-[var(--color-amarelo-arbitro)] text-black"
                : r.posicao <= 3
                  ? "bg-white/10 text-white"
                  : "bg-white/5 text-white/70",
            )}
          >
            {r.posicao}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">
              {r.nome}{" "}
              {r.isVoce ? (
                <span className="ml-1 text-xs uppercase tracking-wider text-[var(--color-verde-conexao)]">
                  (você)
                </span>
              ) : null}
              {r.posicao === 1 ? (
                <Crown
                  size={14}
                  className="ml-1 inline-block text-[var(--color-amarelo-arbitro)]"
                />
              ) : null}
            </p>
          </div>
          <div className="text-right">
            <p className="font-[var(--font-display)] text-xl text-[var(--color-verde-conexao)]">
              {r.pontuacao}
            </p>
            <p className="text-[10px] uppercase tracking-wider text-white/45">
              pontos
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

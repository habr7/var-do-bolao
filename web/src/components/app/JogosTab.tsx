import { Check, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { waLink } from "@/lib/constants";
import { formatDataHora } from "@/lib/format";

type Jogo = {
  jogoId: string;
  timeCasa: string;
  timeVisitante: string;
  dataHora: string;
  status: string;
  jaPalpitou: boolean;
  palpiteCasa: number | null;
  palpiteVisitante: number | null;
};

export function JogosTab({
  rodada,
  jogos,
}: {
  rodada: { numero: number; status: string } | null;
  jogos: Jogo[];
}) {
  if (!rodada || jogos.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-white/15 p-8 text-center text-white/55">
        Nenhuma rodada aberta no momento.
      </p>
    );
  }

  return (
    <div>
      <header className="mb-4 flex items-center justify-between">
        <h3 className="font-[var(--font-display)] uppercase">
          Rodada {rodada.numero}
        </h3>
        <p className="text-xs uppercase tracking-wider text-white/55">
          {rodada.status === "ABERTA" ? "Aberta · dá pra palpitar" : rodada.status}
        </p>
      </header>

      <ul className="space-y-2">
        {jogos.map((j) => {
          const linkPalpitar = waLink(
            `Palpite ${j.timeCasa} 0x0 ${j.timeVisitante}`,
          );
          return (
            <li
              key={j.jogoId}
              className="grid grid-cols-[1fr,auto] items-center gap-4 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="text-xs text-white/55">
                  {formatDataHora(j.dataHora)}
                </p>
                <p className="mt-1 truncate font-semibold">
                  {j.timeCasa} <span className="text-white/40">×</span>{" "}
                  {j.timeVisitante}
                </p>
                {j.jaPalpitou ? (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-[var(--color-verde-conexao)]">
                    <Check size={12} /> Seu palpite: {j.palpiteCasa}–
                    {j.palpiteVisitante}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--color-amarelo-arbitro)]">
                    Falta palpitar
                  </p>
                )}
              </div>
              <Button href={linkPalpitar} variant={j.jaPalpitou ? "secondary" : "primary"} size="md">
                <MessageCircle size={14} />
                {j.jaPalpitou ? "Editar" : "Palpitar"}
              </Button>
            </li>
          );
        })}
      </ul>

      <p className="mt-6 text-center text-xs text-white/45">
        Palpites são feitos pelo WhatsApp — o botão abre a conversa com o bot
        já com a mensagem pronta.
      </p>
    </div>
  );
}

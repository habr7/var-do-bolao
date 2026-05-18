"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "./ComoFunciona";
import { cn } from "@/lib/cn";

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: "É grátis?",
    a: "Sim. Criar bolão e participar é gratuito nesta fase. Sem pegadinha, sem assinatura, sem pedido de cartão.",
  },
  {
    q: "Como funciona a pontuação?",
    a: (
      <>
        Sistema tradicional:
        <ul className="mt-2 space-y-1 text-sm">
          <li>
            <strong className="text-[var(--color-verde-conexao)]">10 pts</strong> · placar exato
          </li>
          <li>
            <strong className="text-[var(--color-verde-conexao)]">7 pts</strong> · acertou resultado + gols de um time
          </li>
          <li>
            <strong className="text-[var(--color-verde-conexao)]">5 pts</strong> · só o resultado
          </li>
          <li>
            <strong className="text-[var(--color-verde-conexao)]">3 pts</strong> · só os gols de um lado
          </li>
          <li>
            <strong className="text-white/60">0 pts</strong> · errou tudo
          </li>
        </ul>
      </>
    ),
  },
  {
    q: "Posso editar meu palpite?",
    a: 'Pode, enquanto a rodada estiver aberta. Manda "editar palpite" pro bot e ele te leva pelo passo a passo.',
  },
  {
    q: "Funciona em iPhone e Android?",
    a: "Funciona em qualquer celular com WhatsApp. Não tem app pra baixar, é tudo na conversa.",
  },
  {
    q: "Meus palpites são privados?",
    a: "São. Só você vê os seus até o jogo acontecer — sem dar mole pros adversários do bolão.",
  },
  {
    q: "Posso participar de mais de um bolão?",
    a: "Pode. O bot detecta automaticamente em qual bolão você quer palpitar quando a mensagem chega.",
  },
  {
    q: "E se eu não souber programar nada?",
    a: "Não precisa. Tudo é em português natural — \"Brasil 2x1 Marrocos\", \"meus pontos\", \"ranking\". O bot entende.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="py-20 md:py-28">
      <Container>
        <SectionHeader
          kicker="Tira a dúvida"
          title="Perguntas frequentes"
          subtitle="Se sobrar dúvida, manda email pra gente — link no rodapé."
        />

        <div className="mx-auto mt-12 max-w-3xl divide-y divide-white/10 overflow-hidden rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/60">
          {FAQS.map((item, i) => {
            const isOpen = open === i;
            return (
              <div key={i}>
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-white/[0.04]"
                >
                  <span className="font-semibold text-white">{item.q}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors",
                      isOpen && "border-[var(--color-verde-conexao)] text-[var(--color-verde-conexao)]",
                    )}
                  >
                    {isOpen ? <Minus size={16} /> : <Plus size={16} />}
                  </span>
                </button>
                <div
                  className={cn(
                    "grid overflow-hidden transition-all duration-300",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="min-h-0">
                    <div className="px-6 pb-6 text-sm leading-relaxed text-white/75 md:text-base">
                      {item.a}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

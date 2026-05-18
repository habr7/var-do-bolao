import { Calculator, Eye, MessageSquare, Zap } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeader } from "./ComoFunciona";

const BENEFITS = [
  {
    icon: MessageSquare,
    title: "100% no WhatsApp",
    body: "Tudo acontece em DM com o bot. Sem grupo lotado, sem instalar app, sem aprender interface nova.",
  },
  {
    icon: Zap,
    title: "Sem cadastro chato",
    body: "Adiciona o número, manda \"oi\" e cria seu bolão. O bot usa seu nome do WhatsApp pra começar.",
  },
  {
    icon: Calculator,
    title: "Cálculo automático",
    body: "Pontuação tradicional: 10 placar exato · 7 resultado + 1 lado · 5 só resultado · 3 só 1 lado · 0 errou tudo.",
  },
  {
    icon: Eye,
    title: "Privacidade dos palpites",
    body: "Só você vê seus palpites até a bola rolar. Sem espionagem, sem palpite copiado.",
  },
] as const;

export function PorQue() {
  return (
    <section id="por-que" className="relative py-20 md:py-28">
      <Container>
        <SectionHeader
          kicker="Por que escolher"
          title="Por que VAR do Bolão"
          subtitle="O bolão da firma deveria ser fácil. A gente fez pra ser."
        />

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-[var(--radius-card)] border border-white/10 bg-white/[0.03] p-6 transition-all hover:border-[var(--color-verde-conexao)]/50 hover:bg-white/[0.05]"
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--color-verde-conexao)]/15 text-[var(--color-verde-conexao)]">
                <Icon size={22} />
              </div>
              <h3 className="font-[var(--font-display)] text-base uppercase">
                {title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-white/70">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

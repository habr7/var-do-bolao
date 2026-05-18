import { MessageCircle, PlusCircle, Smartphone } from "lucide-react";
import { Container } from "@/components/ui/Container";

const STEPS = [
  {
    icon: Smartphone,
    n: "01",
    title: "Adiciona o bot",
    body: "Salva o número do VAR do Bolão como contato. É só uma conversa direta no WhatsApp — sem grupo, sem app extra.",
  },
  {
    icon: PlusCircle,
    n: "02",
    title: "Cria ou entra",
    body: "Manda \"criar bolão\" pra ser admin. Ou cola o link de convite que alguém te mandou — o bot cuida do resto.",
  },
  {
    icon: MessageCircle,
    n: "03",
    title: "Palpita por chat",
    body: 'Manda "Brasil 2x1 Marrocos" e pronto. O bot detecta, confirma e calcula. Ranking automático de hora em hora.',
  },
] as const;

export function ComoFunciona() {
  return (
    <section id="como-funciona" className="py-20 md:py-28">
      <Container>
        <SectionHeader
          kicker="Em 3 passos"
          title="Como funciona"
          subtitle="Do zero ao primeiro palpite em menos de 2 minutos."
        />

        <div className="mt-14 grid gap-5 md:grid-cols-3">
          {STEPS.map(({ icon: Icon, n, title, body }) => (
            <div
              key={n}
              className="group relative rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/80 p-7 backdrop-blur-sm transition-all hover:border-[var(--color-verde-conexao)]/60 hover:bg-[var(--color-cinza-card-hover)]"
            >
              <div className="mb-5 flex items-center justify-between">
                <span
                  aria-hidden
                  className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-verde-conexao)]/15 text-[var(--color-verde-conexao)] transition-transform group-hover:scale-110"
                >
                  <Icon size={24} />
                </span>
                <span className="font-[var(--font-display)] text-3xl text-white/15">
                  {n}
                </span>
              </div>
              <h3 className="font-[var(--font-display)] text-xl uppercase tracking-tight">
                {title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-white/75">
                {body}
              </p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
}

export function SectionHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker?: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {kicker ? (
        <div className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[var(--color-verde-conexao)]">
          {kicker}
        </div>
      ) : null}
      <h2 className="font-[var(--font-display)] text-3xl uppercase leading-tight md:text-5xl">
        {title}
      </h2>
      {subtitle ? (
        <p className="mt-4 text-base text-white/70 md:text-lg">{subtitle}</p>
      ) : null}
    </div>
  );
}

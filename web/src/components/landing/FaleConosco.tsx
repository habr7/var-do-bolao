import { Mail, MessageCircle } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { CONTACT_EMAIL, CTA_FALAR_BOT } from "@/lib/constants";

export function FaleConosco() {
  return (
    <section id="contato" className="py-20 md:py-28">
      <Container>
        <div className="mx-auto max-w-3xl rounded-[var(--radius-card)] border border-white/10 bg-[var(--color-cinza-card)]/60 p-8 text-center md:p-14">
          <h2 className="font-[var(--font-display)] text-3xl uppercase md:text-4xl">
            Fala com a gente
          </h2>
          <p className="mt-4 text-white/75">
            Pra suporte, dúvida ou sugestão, prefere o caminho mais rápido:
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="group flex items-center justify-center gap-3 rounded-xl border border-white/15 bg-white/[0.03] px-6 py-5 transition-all hover:border-[var(--color-verde-conexao)]/60 hover:bg-white/[0.06]"
            >
              <Mail
                size={20}
                className="text-[var(--color-verde-conexao)] transition-transform group-hover:scale-110"
              />
              <span className="font-semibold text-white">{CONTACT_EMAIL}</span>
            </a>

            <Button href={CTA_FALAR_BOT} variant="primary" size="lg">
              <MessageCircle size={18} />
              Chamar no WhatsApp
            </Button>
          </div>

          <p className="mt-6 text-xs text-white/45">
            Resposta em até 48h úteis. Sem formulário, sem fila — vai direto pra caixa de entrada.
          </p>
        </div>
      </Container>
    </section>
  );
}

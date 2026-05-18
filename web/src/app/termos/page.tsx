import type { Metadata } from "next";
import { PageShell } from "@/components/landing/PageShell";
import { Container } from "@/components/ui/Container";
import { CONTACT_EMAIL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Termos e condições de uso do VAR do Bolão. Serviço gratuito de bolão recreativo.",
};

export default function TermosPage() {
  return (
    <PageShell>
      <Container className="py-16 md:py-24">
        <article className="mx-auto max-w-3xl text-white/85">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-verde-conexao)]">
            Legal
          </p>
          <h1 className="mt-2 font-[var(--font-display)] text-4xl uppercase leading-tight md:text-5xl">
            Termos de Uso
          </h1>
          <p className="mt-3 text-sm text-white/55">
            Última atualização: 17 de maio de 2026
          </p>

          <Section title="1. Aceitação">
            <p>
              Ao usar o VAR do Bolão, você concorda com estes Termos. Se não
              concordar, basta não usar — não há nenhum cadastro automático
              feito sem sua interação direta com o bot.
            </p>
          </Section>

          <Section title="2. O serviço">
            <p>
              VAR do Bolão é um <strong>serviço gratuito</strong> de
              gerenciamento de bolões recreativos de futebol. O serviço opera
              via WhatsApp e oferece consulta de ranking, palpites e pontuação
              pelo site.
            </p>
          </Section>

          <Section title="3. Bolão recreativo · não é casa de apostas">
            <p>
              O VAR do Bolão <strong>não é casa de apostas</strong>. Não há
              premiação em dinheiro mediada pela plataforma. Não captamos,
              processamos ou intermediamos pagamentos para premiação. Qualquer
              acordo entre participantes de um bolão é responsabilidade
              exclusiva deles.
            </p>
          </Section>

          <Section title="4. Conduta do usuário">
            <p>Você concorda em:</p>
            <ul>
              <li>Não usar o serviço para fraude, abuso ou assédio;</li>
              <li>Não tentar burlar limites técnicos (rate limit, anti-spam);</li>
              <li>Não usar nomes de bolões ofensivos, ilegais ou que infrinjam direitos de terceiros;</li>
              <li>Ser maior de 18 anos OU usar sob supervisão de responsável.</li>
            </ul>
          </Section>

          <Section title="5. Suspensão">
            <p>
              Podemos suspender o acesso a qualquer momento em caso de uso
              abusivo, com aviso prévio sempre que possível.
            </p>
          </Section>

          <Section title="6. Disponibilidade">
            <p>
              O serviço é oferecido <em>"como está"</em>. Eventos como
              instabilidade da Evolution API, do WhatsApp ou da hospedagem
              podem causar indisponibilidade temporária. Não nos
              responsabilizamos por palpites não registrados em razão de falhas
              externas.
            </p>
          </Section>

          <Section title="7. Propriedade intelectual">
            <p>
              Marca, logotipo, textos do site e código-fonte são de
              propriedade do VAR do Bolão. Os dados gerados por você (palpites,
              nomes de bolões) permanecem seus — concedendo a nós apenas a
              licença necessária pra operar o serviço.
            </p>
          </Section>

          <Section title="8. Limitação de responsabilidade">
            <p>
              Na máxima extensão permitida por lei, não nos responsabilizamos
              por perdas indiretas, lucros cessantes ou danos morais
              decorrentes do uso do serviço.
            </p>
          </Section>

          <Section title="9. Modificações">
            <p>
              Estes Termos podem ser atualizados. Mudanças relevantes serão
              comunicadas pelo bot com 7 dias de antecedência.
            </p>
          </Section>

          <Section title="10. Foro">
            <p>
              Fica eleito o foro da Comarca de São Paulo/SP para dirimir
              quaisquer controvérsias decorrentes destes Termos.
            </p>
          </Section>

          <Section title="11. Contato">
            <p>
              Dúvidas:{" "}
              <a className="text-[var(--color-verde-conexao)] underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>.
            </p>
          </Section>

          <p className="mt-12 rounded-xl border border-[var(--color-amarelo-arbitro)]/30 bg-[var(--color-amarelo-arbitro)]/[0.05] p-4 text-sm">
            ⚠ <strong>Aviso:</strong> documento-modelo em revisão jurídica.
            Versão final será aprovada antes do go-live em produção.
          </p>
        </article>
      </Container>
    </PageShell>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-[var(--font-display)] text-xl uppercase">{title}</h2>
      <div className="mt-3 space-y-3 text-white/80 [&_a]:text-[var(--color-verde-conexao)] [&_strong]:text-white [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_li]:text-white/80 [&_p]:leading-relaxed">
        {children}
      </div>
    </section>
  );
}

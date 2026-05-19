import type { Metadata } from "next";
import { PageShell } from "@/components/landing/PageShell";
import { Container } from "@/components/ui/Container";
import { CONTACT_EMAIL } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Política de Privacidade",
  description:
    "Como o VAR do Bolão coleta, usa e protege seus dados. Em conformidade com a LGPD.",
};

export default function PoliticaPrivacidadePage() {
  return (
    <PageShell>
      <Container className="py-16 md:py-24">
        <article className="prose-vdb mx-auto max-w-3xl text-white/85">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--color-verde-conexao)]">
            Legal
          </p>
          <h1 className="mt-2 font-[var(--font-display)] text-4xl uppercase leading-tight md:text-5xl">
            Política de Privacidade
          </h1>
          <p className="mt-3 text-sm text-white/55">
            Última atualização: 18 de maio de 2026
          </p>

          <Section title="1. Quem somos">
            <p>
              VAR do Bolão é um serviço gratuito para criação e gestão de
              bolões de futebol via WhatsApp. Esta política descreve como
              tratamos seus dados pessoais em conformidade com a Lei Geral de
              Proteção de Dados (LGPD — Lei 13.709/2018).
            </p>
          </Section>

          <Section title="2. Dados coletados">
            <ul>
              <li><strong>Identificação:</strong> nome (do seu perfil WhatsApp), número de celular.</li>
              <li><strong>Conta web (opcional):</strong> email, senha (armazenada com hash bcrypt cost 12).</li>
              <li>
                <strong>Data de nascimento (opcional):</strong> coletada apenas se você quiser preencher.
                Finalidades: (a) validar que você tem 18+ — ver Termos de Uso; (b) cumprimentar no
                seu aniversário com uma mensagem leve. Não é dado sensível pela LGPD (art. 5º, II)
                e não é compartilhada com terceiros. Você pode editar ou apagar a qualquer momento
                em <strong>Meu perfil</strong>.
              </li>
              <li><strong>Uso do produto:</strong> bolões dos quais participa, palpites, pontuação.</li>
              <li><strong>Códigos OTP:</strong> códigos de 6 dígitos para login web, com TTL curto (10 min) e descartados após uso.</li>
              <li><strong>Técnicos:</strong> IP, agente do navegador, timestamps de acesso — apenas para segurança e prevenção de abuso.</li>
            </ul>
            <p>
              <strong>Não coletamos</strong> dados de localização precisa,
              contatos da agenda, fotos, dados biométricos, ou qualquer informação além do
              estritamente necessário pra operar o bolão.
            </p>
          </Section>

          <Section title="3. Finalidade e base legal">
            <p>
              Os dados são tratados para <strong>execução do serviço</strong>
              {" "}(art. 7º, V LGPD) e, quando aplicável, com base no seu
              {" "}<strong>consentimento</strong> (art. 7º, I) — por exemplo, ao
              ativar lembretes automáticos.
            </p>
          </Section>

          <Section title="4. Compartilhamento">
            <p>Compartilhamos dados apenas com fornecedores essenciais:</p>
            <ul>
              <li><strong>WhatsApp / Meta:</strong> para entrega das mensagens (via Evolution API).</li>
              <li><strong>Hospedagem:</strong> servidores de cloud (Railway / similar) sediados ou com presença na América Latina.</li>
            </ul>
            <p>Nunca vendemos dados. Nunca compartilhamos com anunciantes.</p>
          </Section>

          <Section title="5. Direitos do titular">
            <p>Você pode, a qualquer momento:</p>
            <ul>
              <li>Confirmar a existência de tratamento dos seus dados;</li>
              <li>Acessar uma cópia dos dados;</li>
              <li>Corrigir dados incompletos, inexatos ou desatualizados;</li>
              <li>Solicitar a anonimização, bloqueio ou eliminação dos dados;</li>
              <li>Solicitar a portabilidade;</li>
              <li>Revogar o consentimento.</li>
            </ul>
            <p>
              Para exercer qualquer um desses direitos, envie email para{" "}
              <a className="text-[var(--color-verde-conexao)] underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>.
            </p>
          </Section>

          <Section title="6. Retenção">
            <p>
              Palpites e ranking são mantidos pelo período do campeonato + 1
              ano para fins históricos. Após esse prazo, são anonimizados ou
              eliminados. Dados de conta (nome, email, telefone) são mantidos
              enquanto a conta estiver ativa e excluídos sob solicitação.
            </p>
          </Section>

          <Section title="7. Cookies">
            <p>
              Usamos apenas um cookie técnico de sessão (httpOnly, Secure,
              SameSite=Lax) para manter você logado. Não há trackers de
              terceiros, pixels publicitários ou ferramentas de fingerprint.
            </p>
          </Section>

          <Section title="8. Segurança">
            <p>
              Senhas armazenadas com bcrypt (cost 12). Conexões protegidas por
              HTTPS/TLS. Acesso ao banco restrito por rede privada. Logs
              mascarando números de telefone.
            </p>
          </Section>

          <Section title="9. Encarregado (DPO)">
            <p>
              Encarregado pelo tratamento de dados:{" "}
              <a className="text-[var(--color-verde-conexao)] underline" href={`mailto:${CONTACT_EMAIL}`}>
                {CONTACT_EMAIL}
              </a>.
            </p>
          </Section>

          <Section title="10. Alterações">
            <p>
              Esta política pode ser atualizada. Mudanças relevantes serão
              comunicadas via WhatsApp para usuários ativos com 7 dias de
              antecedência.
            </p>
          </Section>

          <p className="mt-12 rounded-xl border border-[var(--color-amarelo-arbitro)]/30 bg-[var(--color-amarelo-arbitro)]/[0.05] p-4 text-sm">
            ⚠ <strong>Aviso:</strong> esta política é um documento-modelo em
            revisão. A versão final será aprovada por consultoria jurídica
            antes do go-live em produção.
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
      <div className="prose-vdb mt-3 space-y-3 text-white/80 [&_a]:text-[var(--color-verde-conexao)] [&_strong]:text-white [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_li]:text-white/80 [&_p]:leading-relaxed">
        {children}
      </div>
    </section>
  );
}

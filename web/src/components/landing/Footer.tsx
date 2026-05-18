import Link from "next/link";
import { Container } from "@/components/ui/Container";
import { Logo } from "@/components/ui/Logo";
import { CONTACT_EMAIL } from "@/lib/constants";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-white/10 bg-[var(--color-verde-gramado-deep)]/85">
      <Container className="py-12 md:py-16">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <Logo size="md" />
            <p className="mt-4 max-w-xs text-sm text-white/65">
              A resenha do grupo com a precisão dos dados. Bolão de Copa do
              Mundo 100% no WhatsApp.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">
              Site
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link className="hover:text-[var(--color-verde-conexao)]" href="/login">Entrar</Link></li>
              <li><a className="hover:text-[var(--color-verde-conexao)]" href="#como-funciona">Como funciona</a></li>
              <li><a className="hover:text-[var(--color-verde-conexao)]" href="#faq">FAQ</a></li>
              <li>
                <a className="hover:text-[var(--color-verde-conexao)]" href={`mailto:${CONTACT_EMAIL}`}>
                  Fale conosco
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-white/50">
              Legal
            </h3>
            <ul className="mt-4 space-y-2 text-sm">
              <li><Link className="hover:text-[var(--color-verde-conexao)]" href="/politica-privacidade">Política de privacidade</Link></li>
              <li><Link className="hover:text-[var(--color-verde-conexao)]" href="/termos">Termos de uso</Link></li>
            </ul>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-white/45 md:flex-row">
          <p>© {year} VAR do Bolão · Todos os direitos reservados.</p>
          <p>
            Bolão recreativo — sem premiação em dinheiro. Não é casa de apostas.
          </p>
        </div>
      </Container>
    </footer>
  );
}

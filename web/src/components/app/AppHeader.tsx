import Link from "next/link";
import { ChevronRight, Trophy, User } from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { Container } from "@/components/ui/Container";

export function AppHeader({ nome }: { nome: string }) {
  return (
    <header className="border-b border-white/10 bg-[var(--color-verde-gramado-deep)]/85 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/app" aria-label="VAR do Bolão — Dashboard">
            <Logo size="sm" />
          </Link>
          <nav className="hidden items-center gap-5 text-sm md:flex">
            <Link
              href="/app"
              className="flex items-center gap-1.5 text-white/70 hover:text-[var(--color-verde-conexao)]"
            >
              <Trophy size={16} /> Meus bolões
            </Link>
          </nav>
        </div>
        <Link
          href="/app/perfil"
          className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.04] px-3 py-1.5 text-sm hover:border-[var(--color-verde-conexao)]/50"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-verde-conexao)]/15 text-[var(--color-verde-conexao)]">
            <User size={14} />
          </span>
          <span className="hidden max-w-[120px] truncate sm:block">{nome}</span>
          <ChevronRight size={14} className="text-white/40" />
        </Link>
      </Container>
    </header>
  );
}
